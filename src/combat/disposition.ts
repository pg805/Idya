// Action disposition — the coarse hostile/defensive split the telegraph exposes.
// "hostile" lumps every offensive option (strike, DOT, trap, debuff, shove);
// "defensive" is everything else (block, heal, shield, restore, buff). Shared by
// the telegraph and the smart planner's opponent-read so both classify the same.
import Action, { ActionType } from '../weapon/action.js';

const HOSTILE_TYPES = new Set<number>([
  ActionType.Strike, ActionType.DamageOverTime, ActionType.Debuff,
  ActionType.HazardTile, ActionType.SlowTile, ActionType.MoveDebuff, ActionType.DestroyObstacle,
]);

export const isHostile = (a: Action): boolean => HOSTILE_TYPES.has(a.type) || (a.push ?? 0) > 0;
