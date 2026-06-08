import { Board, Pos, BoardConfig } from './board.js';
import { CombatIntent } from './intent.js';
import Weapon from '../weapon/weapon.js';
import { CombatantState, effectiveMove } from './combatant_state.js';
import { PatternEntry } from '../infrastructure/pattern.js';
import { assignInitiative } from './initiative.js';

export interface ActionInfo {
  label: string;
  choice: 'defend' | 'attack' | 'special' | 'pass';
  index: number;
  needsTarget: boolean;   // true for aimed actions that require a target tile
  aimed: boolean;
  targeted: boolean;      // true for Heal/Buff that can target any combatant incl. friendlies
  canTargetSelf: boolean; // true for Heal/Buff — own tile is a valid target
  targetsObstacle?: boolean; // true for Destroy Obstacle — target an obstacle tile, not a combatant
  range: number;
  cost: number;
}

export interface WeaponInfo {
  name: string;
  resourceName: string;
  maxResource: number;
  actions: ActionInfo[];
}

export interface CombatantStatus {
  block:   number;
  dot:     { value: number; rounds: number };
  buff:    { value: number; rounds: number };
  debuff:  { value: number; rounds: number };
  reflect: { value: number; rounds: number };
  shield:  { value: number; rounds: number };
  moveDebuff: { value: number; rounds: number };
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
  weight: number;        // weapon weight; drives initiative roll
  initiative: number;    // rolled at session start: (1..100) - weight. Higher acts first.
  initiativeRank: number;// final 0-based rank across all combatants after tiebreaks; lower = sooner
  sprite?: string;
  status?: CombatantStatus;
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
  teams: { id: string; name: string }[];
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
  // Initiative-roll log captured at session start. Emitted to clients on
  // every join_session so refreshers / late-joiners see it too, and
  // persisted as a synthetic "turn 0" entry in the battle log.
  initiativeLog: string[] = [];
  // Snapshots of combatants removed by the reaper mid-battle. Lets the
  // game_over handler read per-enemy damage / HP / etc. even after the
  // turn loop has cleaned them out of teams and meta.
  readonly deadCombatants: Array<{ combatant: Combatant; meta: CombatantMeta }> = [];

  constructor(id: string, boardConfig: BoardConfig, teams: Team[]) {
    this.id = id;
    this.board = new Board(boardConfig);
    this.teams = teams;
    this.initiativeLog = assignInitiative(this.combatants);
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
    const combatants = this.combatants.map(c => {
      const meta = this.meta.get(c.id);
      const s = meta?.state;
      const status = s ? {
        block:   s.block,
        dot:     { ...s.dot     },
        buff:    { ...s.buff    },
        debuff:  { ...s.debuff  },
        reflect: { ...s.reflect },
        shield:  { ...s.shield  },
        moveDebuff: { ...s.moveDebuff },
      } : undefined;
      // Serialize the *effective* movement range so the client's reach preview
      // shrinks while a move debuff is active (base range stays on the live object).
      const movementRange = s ? effectiveMove(c.movementRange, s) : c.movementRange;
      return { ...c, movementRange, status };
    });
    return {
      id: this.id,
      board: this.board.toJSON(),
      combatants,
      teams: this.teams.map(t => ({ id: t.id, name: t.name })),
      turn: this.turn,
      phase: this.phase,
      telegraphs: this.telegraphs,
    };
  }
}
