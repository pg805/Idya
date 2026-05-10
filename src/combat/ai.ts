import { CombatSession, Combatant, CombatantMeta } from './combat_session.js';
import { CombatIntent, ActionChoice } from './intent.js';
import { chebyshevDist } from './board.js';
import { reachableTiles } from './movement.js';
import { PatternActionType } from '../infrastructure/pattern.js';
import Action, { SELF_TARGET_TYPES } from '../weapon/action.js';

interface ResolvedEntry {
  choice: ActionChoice;
  actionIndex: number;
  action: Action;
}

function findAffordableEntry(meta: CombatantMeta): ResolvedEntry | null {
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
  const reachable = reachableTiles(ai.pos, ai.movementRange, session.board, occupied);

  let bestPos = ai.pos;
  let bestDist = chebyshevDist(ai.pos, target.pos);

  for (const pos of reachable.values()) {
    const d = chebyshevDist(pos, target.pos);
    if (d < bestDist) { bestDist = d; bestPos = pos; }
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

  const finalPos = moveTo ?? ai.pos;
  const distAfterMove = chebyshevDist(finalPos, target.pos);

  if (distAfterMove > action.range) {
    return {
      combatantId: ai.id,
      moveTo,
      action: { type: 'pass', actionIndex: 0, targetPos: null },
    };
  }

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
