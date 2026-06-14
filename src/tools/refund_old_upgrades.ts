// One-time: refund pre-0.2.0 weapon upgrades on weapons the player STILL owns, then
// reset them so they re-upgrade cleanly under the 0.2.0 EV system.
//
// Old upgrades live under `upgrades.player` as per-action deltas (per-profession,
// or the older flat shape) with NO `upgradesDone` marker — that's how we detect
// them. The old accounting (from the pre-rework upgrade_service):
//   • one upgrade = fieldLen points for a field action (floor(Σdeltas / fieldLen)),
//     or +delta for a value action; summed across actions = N, the weapon-total.
//   • the Nth upgrade cost N tier-2 material (N≤12) or (N−10) tier-3 (N≥13).
// We refund the REAL materials the deduction site charged (the upgrade_service TIER
// maps had placeholders; the 0.1.0 fix charged these):
//   EN hiruos/nodol · BS talamite/alloy · LJ treated_sulwood/hardwood.
//
// Idempotent (resets player→{} so a re-run sees nothing). Dry-run by default.
//   node lib/tools/refund_old_upgrades.js [--apply]
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../database/prisma.js';
import { ITEMS } from '../economy/items.js';
import Weapon from '../weapon/weapon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const APPLY = process.argv.includes('--apply');

type Prof = 'lumberjack' | 'blacksmith' | 'enchanter';
const TIER2: Record<Prof, string> = { lumberjack: 'treated_sulwood', blacksmith: 'talamite', enchanter: 'hiruos' };
const TIER3: Record<Prof, string> = { lumberjack: 'hardwood', blacksmith: 'alloy', enchanter: 'nodol' };

// name → field length across all six action sets (field actions only).
function fieldLens(w: any): Map<string, number> {
  const map = new Map<string, number>();
  for (const set of ['defend', 'defend_crit', 'attack', 'attack_crit', 'special', 'special_crit']) {
    for (const a of (w[set] ?? [])) {
      if (a.field && typeof a.field.length === 'number') map.set(a.name, a.field.length);
    }
  }
  return map;
}

// Old totalUpgradesUsed: value delta → +n; field delta array → floor(Σ / fieldLen).
function upgradeCount(deltas: Record<string, number | number[]>, lens: Map<string, number>): number {
  let n = 0;
  for (const [name, d] of Object.entries(deltas)) {
    if (typeof d === 'number') n += d;
    else { const fl = lens.get(name) || d.length || 1; n += Math.floor(d.reduce((a, b) => a + b, 0) / fl); }
  }
  return n;
}

// Cumulative old cost of N upgrades for a profession, as a material→qty map.
function refundFor(N: number, prof: Prof): Record<string, number> {
  let t2 = 0, t3 = 0;
  for (let i = 1; i <= N; i++) { if (i <= 12) t2 += i; else t3 += i - 10; }
  const out: Record<string, number> = {};
  if (t2) out[TIER2[prof]] = (out[TIER2[prof]] ?? 0) + t2;
  if (t3) out[TIER3[prof]] = (out[TIER3[prof]] ?? 0) + t3;
  return out;
}

async function main(): Promise<void> {
  const weapons = await prisma.characterWeapon.findMany();
  const refunds = new Map<string, Record<string, number>>();   // charId → {item: qty}
  const resets: string[] = [];                                  // weapon ids to clear
  let scanned = 0;

  for (const w of weapons) {
    const up = (w.upgrades ?? {}) as any;
    const player = up.player;
    // Old-format only: has player deltas and no new-system upgradesDone marker.
    if (!player || typeof player !== 'object' || Object.keys(player).length === 0) continue;
    if (up.upgradesDone !== undefined) continue;
    scanned++;

    // player may be {prof: {action: delta}} or the flat {action: delta}; normalize.
    const vals = Object.values(player);
    const byProf: Partial<Record<Prof, Record<string, number | number[]>>> =
      (typeof vals[0] === 'number' || Array.isArray(vals[0]))
        ? { enchanter: player }  // flat shape only ever existed on EN-era weapons; resolved below
        : player;

    let def: any;
    try { def = Weapon.from_file(join(root, 'database/weapons', `${w.weapon_key}.yaml`)); }
    catch { console.log(`  ! ${w.weapon_key} (${w.id}) — weapon YAML missing, skipped`); continue; }
    const lens = fieldLens(def);

    const cost: Record<string, number> = {};
    for (const [prof, deltas] of Object.entries(byProf) as [Prof, Record<string, number | number[]>][]) {
      const N = upgradeCount(deltas, lens);
      const r = refundFor(N, prof);
      for (const [m, q] of Object.entries(r)) cost[m] = (cost[m] ?? 0) + q;
      console.log(`  ${w.weapon_key} (char ${w.character_id}) — ${prof}: ${N} upgrades → ${Object.entries(r).map(([m, q]) => `${q} ${m}`).join(', ') || 'nothing'}`);
    }
    const cur = refunds.get(w.character_id) ?? {};
    for (const [m, q] of Object.entries(cost)) cur[m] = (cur[m] ?? 0) + q;
    refunds.set(w.character_id, cur);
    resets.push(w.id);
  }

  console.log(`\n=== Refund old upgrades (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Old-format upgraded weapons:  ${scanned}`);
  console.log('Refunds (per character):');
  if (refunds.size === 0) console.log('    (none)');
  for (const [cid, r] of refunds) console.log(`    - ${cid}: ${Object.entries(r).map(([m, q]) => `${q} ${m}`).join(', ')}`);

  if (!APPLY) { console.log('\nDry run — pass --apply to commit.'); await prisma.$disconnect(); return; }

  await prisma.$transaction(async tx => {
    for (const wid of resets) {
      const w = await tx.characterWeapon.findUnique({ where: { id: wid } });
      const up = (w?.upgrades ?? {}) as any;
      await tx.characterWeapon.update({ where: { id: wid }, data: { upgrades: { ...up, player: {} } } });
    }
    for (const [cid, r] of refunds)
      for (const [item, qty] of Object.entries(r)) {
        const d = ITEMS[item];
        if (d) await tx.item.upsert({ where: { id: item }, update: {}, create: { id: item, name: d.name, description: d.description } });
        await tx.inventoryItem.upsert({
          where:  { character_id_item_id: { character_id: cid, item_id: item } },
          update: { quantity: { increment: qty } },
          create: { character_id: cid, item_id: item, quantity: qty },
        });
      }
  });
  console.log('\n✅ Applied.');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
