import { Pos } from './board.js';

export type ActionChoice = 'defend' | 'attack' | 'special' | 'pass';

export interface CombatIntent {
  combatantId: string;
  moveTo: Pos | null;
  action: {
    type: ActionChoice;
    actionIndex: number;
    targetPos: Pos | null; // tile being targeted; null for self-targeting and pass
    // If a combatant occupied targetPos at intent-submission time, capture
    // their id. At action-resolution time, aimed attacks use this target's
    // *current* position — so the player can't get rugged by the AI dodging
    // off their aim after the player won the tile contest. Empty-tile aims
    // leave this null and behave as before (commit to empty space).
    targetCombatantId?: string;
  };
}
