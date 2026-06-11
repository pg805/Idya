// Body-language telegraph: a vague mood on TWO coarse axes — movement
// (closing/holding/fleeing) and disposition (hostile/defensive) — that
// correlates with intent without naming the move. "Hostile" lumps every
// offensive option (strike, trap, debuff, shove); "defensive" lumps block, heal,
// shield, restore. So a "hostile, closing" bear might smash, lob, or drop thorns
// — you read which off its HP/resource/distance/known kit. Players learn each
// enemy's tells over fights via the per-enemy phrases (Telegraph: in the YAML).
//
// Shared by the live server (refreshTelegraphs) and the dev replay capture.
import { Combatant, CombatantMeta, CombatSession } from './combat_session.js';
import { chebyshevDist } from './board.js';
import { choosePlan } from './ai_planner.js';
import { findAffordableEntry } from './ai.js';
import Action, { ActionType } from '../weapon/action.js';

type Mood = { closing: string; holding: string; fleeing: string };
const MOOD: Record<'hostile' | 'defensive', Mood> = {
  hostile:   { closing: 'Stalking closer',    holding: 'Sizing you up',  fleeing: 'Circling, eyes fixed on you' },
  defensive: { closing: 'Edging in, guarded', holding: 'On its guard',   fleeing: 'Backing away' },
};

const HOSTILE_TYPES = new Set<number>([
  ActionType.Strike, ActionType.DamageOverTime, ActionType.Debuff,
  ActionType.HazardTile, ActionType.SlowTile, ActionType.MoveDebuff, ActionType.DestroyObstacle,
]);
const isHostile = (a: Action) => HOSTILE_TYPES.has(a.type) || (a.push ?? 0) > 0;

export function computeTelegraph(meta: CombatantMeta, ai: Combatant, enemies: Combatant[], session: CombatSession): string {
  if (enemies.length === 0) return '';
  const nearest = enemies.reduce((a, b) =>
    chebyshevDist(ai.pos, a.pos) <= chebyshevDist(ai.pos, b.pos) ? a : b
  );

  let dir: 'closing' | 'holding' | 'fleeing';
  let action: Action;
  if (meta.smartAI) {
    // The plan the planner will actually pick (deterministic → matches what fires).
    const intent = choosePlan(ai, session);
    if (intent.action.type === 'pass') return '';
    const list = (meta.weapon as unknown as Record<string, Action[]>)[intent.action.type];
    const a = list?.[intent.action.actionIndex];
    if (!a) return '';
    action = a;
    if (intent.moveTo) {
      const before = chebyshevDist(ai.pos, nearest.pos);
      const after = chebyshevDist(intent.moveTo, nearest.pos);
      dir = after < before ? 'closing' : after > before ? 'fleeing' : 'holding';
    } else dir = 'holding';
  } else {
    if (meta.pattern.length === 0) return '';
    const resolved = findAffordableEntry(meta);
    if (!resolved) return '';
    action = resolved.action;
    // Pattern units only ever close to range, never flee.
    dir = chebyshevDist(ai.pos, nearest.pos) > resolved.action.range ? 'closing' : 'holding';
  }

  const mood = isHostile(action) ? 'hostile' : 'defensive';
  // Per-enemy phrase if the YAML defines it, else the generic mood.
  return meta.telegraph?.[mood]?.[dir] ?? MOOD[mood][dir];
}
