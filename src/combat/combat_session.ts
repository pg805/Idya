import { Board, Pos, BoardConfig } from './board.js';
import { CombatIntent } from './intent.js';
import Weapon from '../weapon/weapon.js';
import { CombatantState } from './combatant_state.js';
import { PatternEntry } from '../infrastructure/pattern.js';

export interface ActionInfo {
  label: string;
  choice: 'defend' | 'attack' | 'special' | 'pass';
  index: number;
  needsTarget: boolean; // true only for aimed hostile actions
  aimed: boolean;
  range: number;
  cost: number;
}

export interface WeaponInfo {
  name: string;
  resourceName: string;
  maxResource: number;
  actions: ActionInfo[];
}

export interface Combatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  resourceName: string;
  pos: Pos;
  movementRange: number;
  isAI: boolean;
  teamId: string;
  weaponInfo: WeaponInfo;
}

export interface CombatantMeta {
  weapon: Weapon;
  state: CombatantState;
  pattern: PatternEntry[];
  patternIndex: number;
}

export interface Team {
  id: string;
  name: string;
  combatants: Combatant[];
}

export type SessionPhase = 'waiting' | 'intent' | 'resolving' | 'ended';

export interface SessionState {
  id: string;
  board: ReturnType<Board['toJSON']>;
  combatants: Combatant[];
  turn: number;
  phase: SessionPhase;
  telegraphs: Record<string, string>; // combatantId → flavor text of next intent
}

export class CombatSession {
  readonly id: string;
  readonly board: Board;
  readonly teams: Team[];
  readonly meta: Map<string, CombatantMeta> = new Map();
  readonly pendingIntents: Map<string, CombatIntent> = new Map();
  turn: number = 0;
  phase: SessionPhase = 'waiting';
  telegraphs: Record<string, string> = {};

  constructor(id: string, boardConfig: BoardConfig, teams: Team[]) {
    this.id = id;
    this.board = new Board(boardConfig);
    this.teams = teams;
  }

  get combatants(): Combatant[] {
    return this.teams.flatMap(t => t.combatants);
  }

  humanCombatants(): Combatant[] {
    return this.combatants.filter(c => !c.isAI);
  }

  aiCombatants(): Combatant[] {
    return this.combatants.filter(c => c.isAI);
  }

  allHumansSubmitted(): boolean {
    return this.humanCombatants().every(c => this.pendingIntents.has(c.id));
  }

  toState(): SessionState {
    return {
      id: this.id,
      board: this.board.toJSON(),
      combatants: this.combatants,
      turn: this.turn,
      phase: this.phase,
      telegraphs: this.telegraphs,
    };
  }
}
