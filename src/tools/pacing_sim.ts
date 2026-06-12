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
import { upgradeCost, maxUpgrades } from '../economy/upgrade_service.js';

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

// Value any material in tier-1 raw-equivalent via the smelt tree (no craft margin):
// tier-1 = 1, tier-2 = 10 (10 raw → 1), tier-3 = 20 (2 tier-2 → 1).
const rawEquiv = (id: string): number => { const r = produces[id]; if (!r) return 1; return r.ingredients.reduce((s, i) => s + rawEquiv(i.id) * i.q, 0) / r.outQ; };

// Each profession's upgrade-fuel drop lines (its tier-1 + tier-2 material).
const PROF_MAT: Record<string, string[]> = {
  lumberjack: ['sulwood', 'treated_sulwood'],
  blacksmith: ['crude_talamite', 'talamite'],
  enchanter:  ['thuvel', 'hiruos'],
};

// ── enemies ──
type Enemy = { key: string; level: number; matEV: number; korel: number; profRaw: Record<string, number> };
const enemies: Enemy[] = [];
for (const f of fs.readdirSync(join(root, 'database/enemies')).filter(f => f.endsWith('.yaml') && !f.includes('tutorial'))) {
  const d = yaml.load(fs.readFileSync(join(root, 'database/enemies', f), 'utf8')) as { Level: number; Loot?: { Items?: Record<string, unknown>[] } };
  let matEV = 0, korel = 0;
  const profRaw: Record<string, number> = { lumberjack: 0, blacksmith: 0, enchanter: 0 };
  for (const it of d.Loot?.Items ?? []) {
    const id = it['id'] as string;
    const ev = (it['Field'] as number[]).reduce((a, b) => a + b, 0) / (it['Field'] as number[]).length;
    if (it['type'] === 'material') {
      matEV += ev;                                          // crafting fuel — KEPT, not income
      for (const prof of Object.keys(PROF_MAT)) if (PROF_MAT[prof].includes(id)) profRaw[prof] += ev * rawEquiv(id);
    } else korel += ev * sell(id);                          // valuables → sold for Korel
  }
  enemies.push({ key: f.replace('.yaml', ''), level: d.Level, matEV, korel, profRaw });
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

// ── UPGRADE PACING (per profession) ──────────────────────────────
// Wins-to-max is win-rate-independent (all professions farm the same enemies),
// so it isolates whether each profession is fed equally. A "win" = a beaten
// farm target; real fights = wins / win-rate.
const PROFS = ['lumberjack', 'blacksmith', 'enchanter'] as const;
const PROF_T2 = { lumberjack: 'treated_sulwood', blacksmith: 'talamite', enchanter: 'hiruos' };

console.log('\n\nUPGRADE FUEL / WIN (raw-equiv) by profession and enemy:');
console.log('  enemy'.padEnd(20) + PROFS.map(p => p.slice(0, 4).toUpperCase().padStart(7)).join(''));
for (const e of [...enemies].sort((a, b) => b.level - a.level))
  console.log(`  L${e.level} ${e.key.padEnd(15)}` + PROFS.map(p => e.profRaw[p].toFixed(1).padStart(7)).join(''));

// best farm target = most upgrade-fuel raw-equiv per win, for each profession
const bestFarm: Record<string, { key: string; raw: number }> = {};
for (const p of PROFS) {
  const b = [...enemies].sort((x, y) => y.profRaw[p] - x.profRaw[p])[0];
  bestFarm[p] = { key: b.key, raw: b.profRaw[p] };
}

// upgrade schedule cost (raw-equiv), split by tier phase, for an L1-base weapon
console.log('\nWINS TO MAX AN L1 WEAPON (→ L5, 12 upgrades):');
const winsToMax: Record<string, number> = {};
for (const p of PROFS) {
  let t2raw = 0, t3raw = 0;
  for (let n = 1; n <= maxUpgrades(1); n++) {
    const c = upgradeCost(n, p, 1);
    const r = c.quantity * rawEquiv(c.material);
    if (c.material === PROF_T2[p]) t2raw += r; else t3raw += r;
  }
  const f = bestFarm[p];
  const t2w = t2raw / f.raw, t3w = t3raw / f.raw;
  winsToMax[p] = t2w + t3w;
  console.log(`  ${p.padEnd(11)} farm ${f.key.padEnd(10)} ${f.raw.toFixed(1)} raw/win  |  T2 phase ${Math.round(t2w)}w + T3 phase ${Math.round(t3w)}w = ${Math.round(t2w + t3w)} wins  (${t2raw + t3raw} raw)`);
}

// Does material or rank gate upgrades? Compare the material grind to the rank
// grind (the rank schedule is what actually unlocks the 12 upgrade slots).
console.log(`\nGATE CHECK — reaching rank ${GOAL_RANK} (unlocks all 12 upgrades) takes ${fight} fights.`);
console.log('  Material to max a weapon, as a share of that rank journey (at ~0.8 win-rate):');
for (const p of PROFS) {
  const matFights = winsToMax[p] / 0.8;
  console.log(`  ${p.padEnd(11)} ~${Math.round(matFights).toString().padStart(3)} fights of material  =  ${(100 * matFights / fight).toFixed(0)}% of the rank grind`);
}
