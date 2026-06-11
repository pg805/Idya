// The 0.2.0 budget heuristic, extracted so both cost_report and the sim
// correlation use one source of truth. weaponBudget(weapon, level) returns the
// total budget cost a weapon "spends" at a given level (HP + weighted actions).
// See CLAUDE.md "Weapon Balance Tooling" for the model.
import Weapon from '../weapon/weapon.js';
import Action, { ActionType } from '../weapon/action.js';

export interface LevelParams { CAP: number; MU: number; HBASE: number; }
export function levelParams(L: number): LevelParams {
  const CAP = 25 * L * (L + 3) / 2;
  return { CAP, MU: L <= 0 ? 2.5 : 10 * L - 5, HBASE: 0.6 * CAP };
}

const ev = (f: number[]) => (f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0);
const fieldOf = (a: Action) => (((a as unknown as { field?: { field: number[] } }).field?.field) ?? []);
const valueOf = (a: Action) => (a as unknown as { value?: number }).value ?? 0;
const roundsOf = (a: Action) => (a as unknown as { rounds?: number }).rounds ?? 1;

// Cost a single action in budget points (pre one-slot weighting), at reference μ.
function cost(a: Action, MU: number, isCrit = false): number {
  const t = a.type;
  const prevented = (v: number) => (v >= 2 * MU ? MU : v - (v * v) / (4 * MU));
  const aoeMult = (area: number) => (area > 1 ? 1 + 0.15 * (area - 1) : 1);
  const enemyTileMult = (area: number) => (area > 1 ? 1 + 0.5 * (area * area - 1) : 1);
  const selfTileMult = (area: number) => (area > 1 ? 1 + 0.25 * (area - 1) : 1);

  if (t === ActionType.Strike || t === ActionType.DamageOverTime) {
    const E = ev(fieldOf(a));
    const range = isCrit ? 1 : 1 + 0.1 * ((a.range ?? 1) - 1);
    const aim = isCrit ? 1.0 : a.aimed ? (a.area > 1 ? 1.0 : 0.9) : 1.1;
    const rounds = t === ActionType.DamageOverTime ? roundsOf(a) : 1;
    const aoe = isCrit ? 1 : aoeMult(a.area);
    const push = isCrit ? 0 : (a.push ?? 0);
    const smash = isCrit || !(a as unknown as { smash?: boolean }).smash ? 0 : 0.5 * (a.area * a.area - 1);
    return E * range * aim * aoe * rounds + push * 1.5 + smash;
  }
  if (t === ActionType.Block) return prevented(valueOf(a));
  if (t === ActionType.Heal) return valueOf(a);
  if (t === ActionType.Shield || t === ActionType.Debuff) return prevented(valueOf(a)) * roundsOf(a) * 0.5;
  if (t === ActionType.Buff) return valueOf(a) * roundsOf(a) * 0.5;
  if (t === ActionType.Reflect) return valueOf(a) * roundsOf(a) * 0.5;
  if (t === ActionType.BlockTile) return prevented(valueOf(a)) * 3 * selfTileMult(a.area);
  if (t === ActionType.BuffTile) return valueOf(a) * 2 * selfTileMult(a.area);
  if (t === ActionType.HazardTile) return valueOf(a) * 0.7 * enemyTileMult(a.area);
  if (t === ActionType.SlowTile) return 5 * enemyTileMult(a.area);
  if (t === ActionType.MoveDebuff) return roundsOf(a) * 2;
  if (t === ActionType.DestroyObstacle) return ev(fieldOf(a)) * 0.7;
  return 0;
}

// Total budget for a weapon at level L. hpOverride lets enemies pass their Health.
export function weaponBudget(weapon: Weapon, L: number, hpOverride?: number): number {
  const { MU, HBASE } = levelParams(L);
  const nonCrit = [...weapon.defend, ...weapon.attack, ...weapon.special].map(a => cost(a, MU));
  const crits = [...weapon.defend_crit, ...weapon.attack_crit, ...weapon.special_crit].map(a => cost(a, MU, true));
  const best = nonCrit.length ? Math.max(...nonCrit) : 0;
  const restSum = nonCrit.reduce((s, c) => s + c, 0) - best;
  const action = best + 0.25 * restSum + crits.reduce((s, c) => s + c, 0);
  const hp = hpOverride ?? (weapon.hp || 0);
  const hpCost = hp <= HBASE ? hp : HBASE + (hp - HBASE) * 0.5;
  return hpCost + action;
}
