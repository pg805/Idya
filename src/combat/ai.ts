import { CombatSession, Combatant, CombatantMeta } from './combat_session.js';
import { CombatIntent, ActionChoice } from './intent.js';
import { chebyshevDist } from './board.js';
import { reachableDanger } from './movement.js';
import { PatternActionType } from '../infrastructure/pattern.js';
import Action, { SELF_TARGET_TYPES } from '../weapon/action.js';

export interface ResolvedEntry {
  choice: ActionChoice;
  actionIndex: number;
  action: Action;
}

// Walks the AI's pattern starting from the current index, returning the first
// entry the AI can afford to use right now. Exported so the telegraph code can
// reuse it — the telegraph must show what the AI will *actually* do, not just
// the action at the current pattern index (which might be unaffordable and
// will get skipped during intent generation).
export function findAffordableEntry(meta: CombatantMeta): ResolvedEntry | null {
  const { weapon, pattern, patternIndex, state } = meta;

  for (let i = 0; i < pattern.length; i++) {
    const entry = pattern[(patternIndex + i) % pattern.length];

    let choice: ActionChoice = 'pass';
    if (entry.type === PatternActionType.Defend)  choice = 'defend';
    else if (entry.type === PatternActionType.Attack)  choice = 'attack';
    else if (entry.type === PatternActionType.Special) choice = 'special';

    let action: Action | null = null;
    if (choice === 'defend')  action = weapon.defend[entry.index]  ?? null;
    if (choice === 'attack')  action = weapon.attack[entry.index]  ?? null;
    if (choice === 'special') action = weapon.special[entry.index] ?? null;

    if (!action) continue;
    if (action.cost > 0 && action.cost > state.resource_current) continue;

    return { choice, actionIndex: entry.index, action };
  }

  return null;
}

export function generateAIIntent(ai: Combatant, session: CombatSession): CombatIntent {
  const meta = session.meta.get(ai.id);
  if (!meta || meta.pattern.length === 0) return pass(ai.id);

  const enemies = session.combatants.filter(c => c.teamId !== ai.teamId);
  if (enemies.length === 0) return pass(ai.id);

  const resolved = findAffordableEntry(meta);
  if (!resolved) return pass(ai.id);

  const { choice, actionIndex, action } = resolved;

  // Always move toward the nearest enemy
  const target = enemies.reduce((a, b) =>
    chebyshevDist(ai.pos, a.pos) <= chebyshevDist(ai.pos, b.pos) ? a : b
  );

  const occupied = new Set(
    session.combatants.filter(c => c.id !== ai.id).map(c => `${c.pos.x},${c.pos.y}`)
  );
  const reachable = reachableDanger(ai.pos, ai.movementRange, session.board, occupied, ai.teamId);

  // Pick the tile that gets closest to the target. Tiebreak, in order: take the
  // least opposing-hazard damage to get there, then prefer a non-slow destination,
  // then the cheaper path (fewer slow crossings). Closing distance always wins, so
  // the AI still wades through hazards/slow when that's the only way forward.
  const isSlow = (pos: { x: number; y: number }) => (session.board.getTile(pos)?.kind === 'slow' ? 1 : 0);
  let bestPos = ai.pos;
  let bestDist = chebyshevDist(ai.pos, target.pos);
  let bestHazard = 0;        // staying put takes no new hazard
  let bestSlow = isSlow(ai.pos);
  let bestCost = 0;

  for (const { pos, cost, hazard } of reachable.values()) {
    const d = chebyshevDist(pos, target.pos);
    const slow = isSlow(pos);
    const better =
      d < bestDist ||
      (d === bestDist && hazard < bestHazard) ||
      (d === bestDist && hazard === bestHazard && slow < bestSlow) ||
      (d === bestDist && hazard === bestHazard && slow === bestSlow && cost < bestCost);
    if (better) { bestDist = d; bestHazard = hazard; bestSlow = slow; bestCost = cost; bestPos = pos; }
  }

  const moveTo = bestPos === ai.pos ? null : bestPos;

  // Self-targeting actions fire regardless of position
  if (SELF_TARGET_TYPES.has(action.type)) {
    return {
      combatantId: ai.id,
      moveTo,
      action: { type: choice, actionIndex, targetPos: null },
    };
  }

  // Let out-of-range actions fire and miss instead of silently passing —
  // resolution.ts already pays the resource cost and logs an "out of range"
  // line for both aimed and reactive paths, which is the right user-facing
  // feedback. The AI commits to the pattern entry; bad positioning is its
  // own punishment.
  return {
    combatantId: ai.id,
    moveTo,
    action: { type: choice, actionIndex, targetPos: action.aimed ? { ...target.pos } : null },
  };
}

function pass(combatantId: string): CombatIntent {
  return {
    combatantId,
    moveTo: null,
    action: { type: 'pass', actionIndex: 0, targetPos: null },
  };
}
