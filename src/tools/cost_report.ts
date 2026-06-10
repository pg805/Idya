// Cost every weapon against a chosen level's budget filter. Default L2.
//   node ./lib/tools/cost_report.js        # L2 (budget 125, mu 15)
//   node ./lib/tools/cost_report.js 1      # L1, etc.
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as any).silent = true;

import Weapon from '../weapon/weapon.js';
import Action, { ActionType } from '../weapon/action.js';
import { runBattle, aggregate, loadEnemies } from './sim_core.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEAPONS = join(__dirname, '../../database/weapons');
const ENEMIES = join(__dirname, '../../database/enemies');
const SIM_N = 800;  // battles per matchup for the quick win% column (lighter than the full sim)

const L = Number(process.argv[2] ?? 2);
const CAP = 25 * L * (L + 3) / 2;          // budget(L)
// μ = reference attack EV defenses are sized against. Climbs faster than the old
// max_roll=10L curve so damage scales up: μ = 10L−5 for L≥1 (5, 15, 25, 35…),
// floored at 2.5 for the L0 band.
const MU = L <= 0 ? 2.5 : 10 * L - 5;
const MAXROLL = 2 * MU;
const HBASE = 0.6 * CAP;                     // HP diminishing threshold

const ev = (f: number[]) => f.reduce((a, b) => a + b, 0) / f.length;
const prevented = (v: number) => (v >= 2 * MU ? MU : v - (v * v) / (4 * MU));
const aoeMult = (area: number) => (area > 1 ? 1 + 0.15 * (area - 1) : 1);
// Area scaling differs by who the tile faces:
//   enemy-facing (hazard/slow): every one of the area² squares is an independent
//     threat the foe can step into, so it scales ~area² (extra tiles at half for
//     overlap / squares the enemy never enters).
//   self-facing (block/buff): the caster only ever stands on ONE square, so a
//     bigger zone is just coverage/flexibility — a gentle linear bonus, not area².
const enemyTileMult = (area: number) => (area > 1 ? 1 + 0.5 * (area * area - 1) : 1);
const selfTileMult  = (area: number) => (area > 1 ? 1 + 0.25 * (area - 1) : 1);

// Cost a single action in budget points (pre one-slot weighting).
function cost(a: Action, isCrit = false): number {
  const t = a.type;
  if (t === ActionType.Strike || t === ActionType.DamageOverTime) {
    const E = ev((a as any).field.field as number[]);
    // Crits ride the triggering attack's target — the engine ignores a crit's own
    // range/aim/area/push, so they're free here too (only the damage payload and
    // any DOT rounds matter).
    const range = isCrit ? 1 : 1 + 0.1 * ((a.range ?? 1) - 1);
    const aim = isCrit ? 1.0 : a.aimed ? (a.area > 1 ? 1.0 : 0.9) : 1.1;
    const rounds = t === ActionType.DamageOverTime ? (a as any).rounds : 1;
    const aoe = isCrit ? 1 : aoeMult(a.area);
    const push = isCrit ? 0 : (a.push ?? 0);
    // Smash rider: flattens obstacles in the block (clearing cover + opening LOS).
    // Utility scales with the block size; ~0.5 per area square, zero at area 1.
    const smash = isCrit || !(a as any).smash ? 0 : 0.5 * (a.area * a.area - 1);
    // Push rider: ~1.5 budget per square of knockback (rough control estimate).
    return E * range * aim * aoe * rounds + push * 1.5 + smash;
  }
  if (t === ActionType.Block) return prevented((a as any).value);
  if (t === ActionType.Heal) return (a as any).value;
  if (t === ActionType.Shield || t === ActionType.Debuff) return prevented((a as any).value) * ((a as any).rounds ?? 1) * 0.5;
  if (t === ActionType.Buff) return ((a as any).value) * ((a as any).rounds ?? 1) * 0.5;
  if (t === ActionType.Reflect) return ((a as any).value) * ((a as any).rounds ?? 1) * 0.5;
  if (t === ActionType.BlockTile) return prevented((a as any).value) * 3 * selfTileMult(a.area);
  if (t === ActionType.BuffTile) return (a as any).value * 2 * selfTileMult(a.area);
  if (t === ActionType.HazardTile) return (a as any).value * 0.7 * enemyTileMult(a.area);
  if (t === ActionType.SlowTile) return 5 * enemyTileMult(a.area);  // rough control estimate
  if (t === ActionType.MoveDebuff) return ((a as any).rounds ?? 1) * 2;  // unit-attached slow, rough control estimate
  if (t === ActionType.DestroyObstacle) return ev((a as any).field.field) * 0.7;
  return 0;
}

function unitBudget(w: Weapon, hpOverride?: number): { budget: number; hp: number; best: number; crit: number } {
  const nonCrit = [...w.defend, ...w.attack, ...w.special].map(a => cost(a));
  const crits = [...w.defend_crit, ...w.attack_crit, ...w.special_crit].map(a => cost(a, true));
  const best = nonCrit.length ? Math.max(...nonCrit) : 0;
  const restSum = nonCrit.reduce((s, c) => s + c, 0) - best;
  const critSum = crits.reduce((s, c) => s + c, 0);
  const action = best + 0.25 * restSum + critSum;
  const hp = hpOverride ?? (w.hp || 0);
  const hpCost = hp <= HBASE ? hp : HBASE + (hp - HBASE) * 0.5;
  return { budget: hpCost + action, hp, best, crit: critSum };
}

const level = (b: number) => (-3 + Math.sqrt(9 + 8 * b / 25)) / 2;

// Same-tier enemies for the win% column: enemies whose Level matches the filter.
const sameTierEnemies = loadEnemies(ENEMIES).filter(e => (e.data.Level ?? 0) === L);

// Quick sim win% for a weapon vs every same-tier enemy, averaged. null if no
// same-tier enemy exists to test against. (Non-spatial — undervalues ranged /
// control / AoE weapons, same blind spot as the budget.)
function quickWinRate(w: Weapon): number | null {
  if (sameTierEnemies.length === 0 || w.attack.length === 0) return null;
  let sum = 0;
  for (const e of sameTierEnemies) {
    const results = Array.from({ length: SIM_N }, () => runBattle(w, e.data));
    sum += aggregate(results).winRate;
  }
  return sum / sameTierEnemies.length;
}

console.log(`\nL${L} filter — cap ${CAP}, μ ${MU}, max_roll ${MAXROLL}, H_base ${HBASE}`);
console.log(`win% = avg vs same-tier enemies [${sameTierEnemies.map(e => e.data.Name).join(', ') || 'none'}], ${SIM_N} battles each (non-spatial)\n`);
console.log(`${'Weapon'.padEnd(20)}${'yaml'.padStart(5)}${'HP'.padStart(5)}${'budget'.padStart(9)}${'level'.padStart(7)}${'win%'.padStart(7)}${'  vs ' + CAP}`);
console.log('-'.repeat(67));

const rows = fs.readdirSync(WEAPONS).filter(f => f.endsWith('.yaml')).map(f => {
  const raw = yaml.load(fs.readFileSync(join(WEAPONS, f), 'utf-8')) as { Level?: number };
  const w = Weapon.from_file(join(WEAPONS, f));
  const { budget } = unitBudget(w);
  const names = (arr: Action[]) => arr.map(a => a.name).join(', ') || '—';
  return {
    name: w.name, yaml: raw.Level ?? 0, hp: w.hp || 0, budget, lvl: level(budget), win: quickWinRate(w),
    atk: names(w.attack), crit: names([...w.attack_crit, ...w.defend_crit, ...w.special_crit]),
    spc: names(w.special), def: names(w.defend),
  };
}).sort((a, b) => a.budget - b.budget);

for (const r of rows) {
  const gap = r.budget - CAP;
  const win = r.win === null ? '—' : `${(r.win * 100).toFixed(0)}%`;
  console.log(`${r.name.slice(0, 19).padEnd(20)}${('L' + r.yaml).padStart(5)}${String(r.hp).padStart(5)}${r.budget.toFixed(1).padStart(9)}${('L' + r.lvl.toFixed(2)).padStart(7)}${win.padStart(7)}${(gap >= 0 ? '  +' : '  ') + gap.toFixed(1)}`);
  console.log(`    A: ${r.atk}  |  AC: ${r.crit}  |  S: ${r.spc}  |  D: ${r.def}`);
}

// Enemies at this tier — costed the same way (Health as HP + one-slot weapon).
const enemyRows = loadEnemies(ENEMIES).filter(e => (e.data.Level ?? 0) === L).map(e => {
  const w = Weapon.from_json(e.data.Weapon as any);
  const { budget } = unitBudget(w, e.data.Health);
  const names = (arr: Action[]) => arr.map(a => a.name).join(', ') || '—';
  const pat = (e.data.Pattern ?? []) as [number, number][];
  const atkFreq = pat.length ? pat.filter(([t]) => t === 2 || t === 3).length / pat.length : 0;
  return {
    name: e.data.Name, hp: e.data.Health, budget, lvl: level(budget), atkFreq,
    atk: names(w.attack), crit: names([...w.attack_crit, ...w.defend_crit, ...w.special_crit]),
    spc: names(w.special), def: names(w.defend),
  };
}).sort((a, b) => a.budget - b.budget);

if (enemyRows.length) {
  console.log(`\nL${L} ENEMIES — budget + pattern attack-frequency (threat ≈ how often the pattern attacks)`);
  console.log(`${'Enemy'.padEnd(20)}${'HP'.padStart(5)}${'budget'.padStart(9)}${'level'.padStart(7)}${'atk%'.padStart(7)}${'  vs ' + CAP}`);
  console.log('-'.repeat(60));
  for (const r of enemyRows) {
    const gap = r.budget - CAP;
    console.log(`${r.name.slice(0, 19).padEnd(20)}${String(r.hp).padStart(5)}${r.budget.toFixed(1).padStart(9)}${('L' + r.lvl.toFixed(2)).padStart(7)}${(r.atkFreq * 100).toFixed(0).padStart(6)}%${(gap >= 0 ? '  +' : '  ') + gap.toFixed(1)}`);
    console.log(`    A: ${r.atk}  |  AC: ${r.crit}  |  S: ${r.spc}  |  D: ${r.def}`);
  }
}
console.log('');
