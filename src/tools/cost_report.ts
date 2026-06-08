// Cost every weapon against a chosen level's budget filter. Default L2.
//   node ./lib/tools/cost_report.js        # L2 (budget 125, mu 15)
//   node ./lib/tools/cost_report.js 1      # L1, etc.
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as any).silent = true;

import Weapon from '../weapon/weapon.js';
import Action, { ActionType } from '../weapon/action.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEAPONS = join(__dirname, '../../database/weapons');

const L = Number(process.argv[2] ?? 2);
const CAP = 25 * L * (L + 3) / 2;          // budget(L)
// μ = reference attack EV defenses are sized against. Per-level so damage scale
// can creep up faster than the old max_roll=10L curve: L1 stays 5, L2 → 15.
const MU_TABLE: Record<number, number> = { 0: 2.5, 1: 5, 2: 15 };
const MU = MU_TABLE[L] ?? (10 * L) / 2;
const MAXROLL = 2 * MU;
const HBASE = 0.6 * CAP;                     // HP diminishing threshold

const ev = (f: number[]) => f.reduce((a, b) => a + b, 0) / f.length;
const prevented = (v: number) => (v >= 2 * MU ? MU : v - (v * v) / (4 * MU));
const aoeMult = (area: number) => (area > 1 ? 1 + 0.15 * (area - 1) : 1);

// Cost a single action in budget points (pre one-slot weighting).
function cost(a: Action, isCrit = false): number {
  const t = a.type;
  if (t === ActionType.Strike || t === ActionType.DamageOverTime) {
    const E = ev((a as any).field.field as number[]);
    const range = 1 + 0.1 * ((a.range ?? 1) - 1);
    const aim = isCrit ? 1.0 : a.aimed ? (a.area > 1 ? 1.0 : 0.9) : 1.1;
    const rounds = t === ActionType.DamageOverTime ? (a as any).rounds : 1;
    return E * range * aim * aoeMult(a.area) * rounds;
  }
  if (t === ActionType.Block) return prevented((a as any).value);
  if (t === ActionType.Heal) return (a as any).value;
  if (t === ActionType.Shield || t === ActionType.Debuff) return prevented((a as any).value) * ((a as any).rounds ?? 1) * 0.5;
  if (t === ActionType.Buff) return ((a as any).value) * ((a as any).rounds ?? 1) * 0.5;
  if (t === ActionType.Reflect) return ((a as any).value) * ((a as any).rounds ?? 1) * 0.5;
  if (t === ActionType.BlockTile) return prevented((a as any).value) * 3;
  if (t === ActionType.BuffTile) return (a as any).value * 2;
  if (t === ActionType.HazardTile) return (a as any).value * 0.7;
  if (t === ActionType.SlowTile) return 5;  // rough control estimate
  if (t === ActionType.DestroyObstacle) return ev((a as any).field.field) * 0.7;
  return 0;
}

function unitBudget(w: Weapon): { budget: number; hp: number; best: number; crit: number } {
  const nonCrit = [...w.defend, ...w.attack, ...w.special].map(a => cost(a));
  const crits = [...w.defend_crit, ...w.attack_crit, ...w.special_crit].map(a => cost(a, true));
  const best = nonCrit.length ? Math.max(...nonCrit) : 0;
  const restSum = nonCrit.reduce((s, c) => s + c, 0) - best;
  const critSum = crits.reduce((s, c) => s + c, 0);
  const action = best + 0.25 * restSum + critSum;
  const hp = w.hp || 0;
  const hpCost = hp <= HBASE ? hp : HBASE + (hp - HBASE) * 0.5;
  return { budget: hpCost + action, hp, best, crit: critSum };
}

const level = (b: number) => (-3 + Math.sqrt(9 + 8 * b / 25)) / 2;

console.log(`\nL${L} filter — cap ${CAP}, μ ${MU}, max_roll ${MAXROLL}, H_base ${HBASE}\n`);
console.log(`${'Weapon'.padEnd(20)}${'yaml'.padStart(5)}${'HP'.padStart(5)}${'budget'.padStart(9)}${'level'.padStart(7)}${'  vs ' + CAP}`);
console.log('-'.repeat(60));

const rows = fs.readdirSync(WEAPONS).filter(f => f.endsWith('.yaml')).map(f => {
  const raw = yaml.load(fs.readFileSync(join(WEAPONS, f), 'utf-8')) as { Level?: number };
  const w = Weapon.from_file(join(WEAPONS, f));
  const { budget } = unitBudget(w);
  const names = (arr: Action[]) => arr.map(a => a.name).join(', ') || '—';
  return {
    name: w.name, yaml: raw.Level ?? 0, hp: w.hp || 0, budget, lvl: level(budget),
    atk: names(w.attack), crit: names([...w.attack_crit, ...w.defend_crit, ...w.special_crit]),
    spc: names(w.special), def: names(w.defend),
  };
}).sort((a, b) => a.budget - b.budget);

for (const r of rows) {
  const gap = r.budget - CAP;
  console.log(`${r.name.slice(0, 19).padEnd(20)}${('L' + r.yaml).padStart(5)}${String(r.hp).padStart(5)}${r.budget.toFixed(1).padStart(9)}${('L' + r.lvl.toFixed(2)).padStart(7)}${(gap >= 0 ? '  +' : '  ') + gap.toFixed(1)}`);
  console.log(`    A: ${r.atk}  |  AC: ${r.crit}  |  S: ${r.spc}  |  D: ${r.def}`);
}
console.log('');
