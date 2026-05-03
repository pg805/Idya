import { Pos } from './board.js';

export type ActionChoice = 'defend' | 'attack' | 'special' | 'pass';

export interface CombatIntent {
  combatantId: string;
  moveTo: Pos | null;
  action: {
    type: ActionChoice;
    actionIndex: number;
    targetPos: Pos | null; // tile being targeted; null for self-targeting and pass
  };
}
