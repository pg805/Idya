// Pacing sim — models a player's progression arc to sanity-check the economy:
// how many fights to reach each profession rank and to craft each weapon tier,
// using the REAL drop tables, sell prices, rank schedule, and craft costs.
//
// Korel (for rank-ups) comes from selling valuables; materials (for crafting)
// are kept. The player farms the enemy that maximises effective value per fight
// (drops × win-rate) among the ones they can beat. Win-rate is a simple model
// off the spatial matrix: weapon above enemy = easy, equal = coin-flip-ish,
// below = bad.   node lib/tools/pacing_sim.js
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

// ── prices ──
const base: Record<string, { buy: number; sell: number }> = {};
for (const f of fs.readdirSync(join(root, 'database/shops')).filter(f => f.endsWith('.yaml'))) {
  const d = yaml.load(fs.readFileSync(join(root, 'database/shops', f), 'utf8')) as { Items?: Record<string, unknown>[] };
  for (const it of d.Items ?? []) base[it['id'] as string] = { buy: it['Base_Buy'] as number, sell: it['Base_Sell'] as number };
}
const produces: Record<string, { ingredients: { id: string; q: number }[]; outQ: number }> = {};
for (const p of ['lumberjack', 'blacksmith', 'enchanter']) {
  const d = yaml.load(fs.readFileSync(join(root, 'database/recipes', p + '.yaml'), 'utf8')) as { recipes?: Record<string, unknown>[] };
  for (const r of d.recipes ?? []) { const o = r['output'] as Record<string, unknown>; if (o?.['id'] && o['type'] !== 'enchant' && !produces[o['id'] as string]) produces[o['id'] as string] = { ingredients: (r['ingredients'] as Record<string, unknown>[]).map(i => ({ id: (i['item_id'] ?? i['weapon_id']) as string, q: i['quantity'] as number })), outQ: (o['quantity'] as number) ?? 1 }; }
}
const sell = (id: string): number => { const r = produces[id]; if (!r) return base[id]?.sell ?? 0; return (r.ingredients.reduce((s, i) => s + sell(i.id) * i.q, 0) / r.outQ) * 1.5; };

// ── enemies ──
type Enemy = { key: string; level: number; matEV: number; korel: number };
const enemies: Enemy[] = [];
for (const f of fs.readdirSync(join(root, 'database/enemies')).filter(f => f.endsWith('.yaml') && !f.includes('tutorial'))) {
  const d = yaml.load(fs.readFileSync(join(root, 'database/enemies', f), 'utf8')) as { Level: number; Loot?: { Items?: Record<string, unknown>[] } };
  let matEV = 0, korel = 0;
  for (const it of d.Loot?.Items ?? []) {
    const ev = (it['Field'] as number[]).reduce((a, b) => a + b, 0) / (it['Field'] as number[]).length;
    if (it['type'] === 'material') matEV += ev;             // crafting fuel — KEPT, not income
    else korel += ev * sell(it['id'] as string);            // valuables → sold for Korel
  }
  enemies.push({ key: f.replace('.yaml', ''), level: d.Level, matEV, korel });
}
enemies.sort((a, b) => a.level - b.level);

console.log('INCOME / FIGHT (sell ALL drops) and material gain:');
for (const e of enemies) console.log(`  L${e.level} ${e.key.padEnd(16)} ${Math.round(e.korel).toString().padStart(4)} korel/win   ${e.matEV.toFixed(1)} mat/win`);

// ── win model + costs ──
const winRate = (wL: number, eL: number) => wL > eL ? 0.9 : wL === eL ? 0.45 : wL === eL - 1 ? 0.15 : 0.02;
const RANK = [100, 300, 700, 1500, 3000, 6000, 12000, 22000, 40000, 75000];   // first 10 combined ranks
const WEAPON_MAT = [0, 12, 100, 200];                                          // raw-equiv to craft L1/L2/L3

// ── run ──
let fight = 0, korel = 0, mat = 0, wL = 0, rank = 0;
const log: string[] = [];
const GOAL_RANK = 10;
while (rank < GOAL_RANK && fight < 100000) {
  // farm the enemy with the best effective value/fight we can reasonably win (wr >= 0.3)
  const cand = enemies.filter(e => winRate(wL, e.level) >= 0.3).sort((a, b) => (b.korel * winRate(wL, b.level)) - (a.korel * winRate(wL, a.level)))[0] ?? enemies[0];
  const wr = winRate(wL, cand.level);
  fight++; korel += wr * cand.korel; mat += wr * cand.matEV;
  if (wL < 3 && mat >= WEAPON_MAT[wL + 1]) { mat -= WEAPON_MAT[wL + 1]; wL++; log.push(`fight ${fight}: crafted L${wL} weapon (farming ${cand.key})`); }
  while (rank < GOAL_RANK && korel >= RANK[rank]) { korel -= RANK[rank]; rank++; log.push(`fight ${fight}: reached rank ${rank}  (cumulative)`); }
}
console.log('\nPROGRESSION (farm-best-beatable policy):');
for (const l of log) console.log('  ' + l);
console.log(`\n  → rank ${GOAL_RANK} reached at fight ${fight}`);
