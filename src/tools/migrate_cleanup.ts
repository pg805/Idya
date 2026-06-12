// One-time cleanup migration: strip removed content from player data + refund.
//
//   • Old-format enchants (pre-0.2.0 rework — keyed by action name, kind:minor/major)
//     are stripped; refunds the historical enchant material cost (minor 3 thuvel +
//     6 hiruos; major +9 nodol). New-format enchants (type health/melee/ranged/
//     upgrade) are kept.
//   • Weapons whose YAML no longer exists are deleted; refunds the recipe's
//     material cost if a recipe still exists (else just removed — unpriceable).
//     A character's equipped_weapon_id is nulled if it pointed at a deleted weapon.
//
// Idempotent. Dry-run by default — pass --apply to commit. Needs DATABASE_URL.
//   node lib/tools/migrate_cleanup.js [--apply]
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../database/prisma.js';
import { loadAllRecipes } from '../economy/recipe_loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const APPLY = process.argv.includes('--apply');

const validWeapons = new Set(
  fs.readdirSync(join(root, 'database/weapons')).filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', '')),
);
const recipes = loadAllRecipes(join(root, 'database/recipes'));
const recipeFor = (key: string) => recipes.find(r => r.output.type === 'weapon' && r.output.id === key);

const NEW_TYPES = new Set(['health', 'melee', 'ranged', 'upgrade']);
const MINOR_REFUND: Record<string, number> = { thuvel: 3, hiruos: 6 };
const MAJOR_REFUND: Record<string, number> = { thuvel: 3, hiruos: 6, nodol: 9 };
// Flat refund for removed weapons that no longer have a recipe to price them.
// Resolved from the old recipes (git history) down to currently-existing materials:
//   quarterstaff   = 4 sulwood
//   wand_talamite  = wand_base_talamite(5 talamite) + 9 hiruos
//   sword_talamite = sword_hilt(6 treated_sulwood) + sword_blade_talamite(8 talamite)
const REMOVED_WEAPON_REFUND: Record<string, Record<string, number>> = {
  quarterstaff:   { sulwood: 4 },
  wand_talamite:  { talamite: 5, hiruos: 9 },
  sword_talamite: { treated_sulwood: 6, talamite: 8 },
};

const refunds = new Map<string, Record<string, number>>();   // charId → { item: qty }
function addRefund(charId: string, cost: Record<string, number>) {
  const r = refunds.get(charId) ?? {};
  for (const [m, q] of Object.entries(cost)) r[m] = (r[m] ?? 0) + q;
  refunds.set(charId, r);
}

async function main() {
  const weapons = await prisma.characterWeapon.findMany();
  const chars   = await prisma.character.findMany({ select: { id: true, equipped_weapon_id: true } });
  const equippedOf = new Map(chars.map(c => [c.id, c.equipped_weapon_id]));

  const weaponUpdates: { id: string; upgrades: unknown }[] = [];
  const weaponDeletes: { id: string; key: string; charId: string }[] = [];
  const unequip   = new Set<string>();   // character ids whose equipped weapon is being deleted
  const unpriced  = new Set<string>();   // missing weapon keys we couldn't refund
  let oldEnchants = 0;

  for (const w of weapons) {
    // 1. weapon no longer exists → delete (+ refund: flat table, else recipe cost, else flag)
    if (!validWeapons.has(w.weapon_key)) {
      weaponDeletes.push({ id: w.id, key: w.weapon_key, charId: w.character_id });
      if (equippedOf.get(w.character_id) === w.id) unequip.add(w.character_id);
      const flat = REMOVED_WEAPON_REFUND[w.weapon_key];
      const recipe = flat ? null : recipeFor(w.weapon_key);
      if (flat) addRefund(w.character_id, flat);
      else if (recipe) for (const ing of recipe.ingredients) { if (ing.item_id) addRefund(w.character_id, { [ing.item_id]: ing.quantity }); }
      else unpriced.add(w.weapon_key);
      continue;
    }
    // 2. old-format enchants → strip + refund
    const upgrades = (w.upgrades ?? {}) as { enchants?: Record<string, { type?: string; kind?: string }> };
    const enchants = upgrades.enchants ?? {};
    const old = Object.entries(enchants).filter(([, e]) => !NEW_TYPES.has(String(e?.type)));
    if (old.length > 0) {
      const kept = { ...enchants };
      for (const [k, e] of old) {
        addRefund(w.character_id, e?.kind === 'major' ? MAJOR_REFUND : MINOR_REFUND);
        delete kept[k];
        oldEnchants++;
      }
      weaponUpdates.push({ id: w.id, upgrades: { ...upgrades, enchants: kept } });
    }
  }

  console.log(`\n=== Cleanup migration (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Weapons scanned:                ${weapons.length}`);
  console.log(`Old enchants to strip:          ${oldEnchants}  (on ${weaponUpdates.length} weapons)`);
  console.log(`Nonexistent weapons to delete:  ${weaponDeletes.length}`);
  for (const d of weaponDeletes) console.log(`    - ${d.key} (char ${d.charId})${unequip.has(d.charId) ? ' [equipped → unequip]' : ''}`);
  if (unpriced.size > 0) console.log(`  ⚠ deleted with NO refund (add to REMOVED_WEAPON_REFUND): ${[...unpriced].join(', ')}`);
  console.log(`Refunds (per character):`);
  if (refunds.size === 0) console.log('    (none)');
  for (const [charId, r] of refunds) console.log(`    - ${charId}: ${Object.entries(r).map(([m, q]) => `${q} ${m}`).join(', ')}`);

  if (!APPLY) { console.log('\nDry run — pass --apply to commit.'); await prisma.$disconnect(); return; }

  await prisma.$transaction(async tx => {
    for (const cid of unequip) await tx.character.update({ where: { id: cid }, data: { equipped_weapon_id: null } });
    for (const u of weaponUpdates) await tx.characterWeapon.update({ where: { id: u.id }, data: { upgrades: u.upgrades as object } });
    for (const d of weaponDeletes) await tx.characterWeapon.delete({ where: { id: d.id } });
    for (const [charId, r] of refunds)
      for (const [item, qty] of Object.entries(r))
        await tx.inventoryItem.upsert({
          where:  { character_id_item_id: { character_id: charId, item_id: item } },
          update: { quantity: { increment: qty } },
          create: { character_id: charId, item_id: item, quantity: qty },
        });
  });
  console.log('\n✅ Applied.');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
