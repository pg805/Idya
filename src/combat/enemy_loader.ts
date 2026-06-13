import yaml from 'js-yaml';
import fs from 'fs';
import Weapon from '../weapon/weapon.js';
import Pattern from '../infrastructure/pattern.js';
import { CombatantState } from './combatant_state.js';
import { Combatant, CombatantMeta, WeaponInfo, ActionInfo } from './combat_session.js';
import Action, { SELF_TARGET_TYPES, TILE_TYPES, ActionType } from '../weapon/action.js';
import type { LootTable } from '../economy/reward_service.js';

type EnemyLootData = {
  Currency?: { Field: number[] };
  Items?: Array<{ id: string; type: string; Field: number[] }>;
};

type EnemyData = {
  Name: string;
  Health: number;
  Pattern: [number, number][];
  Weapon: Record<string, unknown>;
  Resistances?: Record<string, number>;
  Loot?: EnemyLootData;
  // body-language phrases, keyed by disposition (hostile/defensive) then movement intent
  Telegraph?: {
    hostile?:   { closing?: string; holding?: string; fleeing?: string };
    defensive?: { closing?: string; holding?: string; fleeing?: string };
  };
};

// An action's full damage field (its die-faces) as a list, so players see the
// real distribution — not a hidden average or just the endpoints. A flat field
// collapses to a single number.
const range = (arr: number[]): string => {
  if (!arr.length) return '0';
  return arr.every(v => v === arr[0]) ? `${arr[0]}` : `[${arr.join(', ')}]`;
};

// A concise, player-facing effect descriptor for one action — the headline value
// plus its riders (area / blink / range / knockback / duration). Surfaced on the
// action panel so stats aren't buried in a tooltip.
function actionStat(a: Action): string {
  const f = (a as unknown as { field?: { field: number[] } }).field?.field;
  const v = (a as unknown as { value?: number }).value;
  const rounds = (a as unknown as { rounds?: number }).rounds;
  const riders: string[] = [];
  if (a.area > 1)               riders.push(`${a.area}×${a.area}`);
  if (a.moveTo)                 riders.push('blink');
  if (a.push > 0)               riders.push('+knock');
  if (a.range > 1 && !a.moveTo) riders.push(`r${a.range}`);
  const tail = riders.length ? ` · ${riders.join(' · ')}` : '';
  switch (a.type) {
    // Damage actions: riders first, the full field LAST (e.g. "3×3 · blink · [25, …]").
    case ActionType.Strike:          return [...riders, range(f ?? [])].join(' · ');
    case ActionType.DamageOverTime:  return ['DOT', ...riders, rounds ? `${rounds}t` : '', range(f ?? [])].filter(Boolean).join(' · ');
    case ActionType.Block:           return (v ?? 0) > 0 ? `block ${v}` : (a.cost < 0 ? `restore ${-a.cost}` : '—');
    case ActionType.Shield:          return `shield ${v}${rounds ? ` · ${rounds}t` : ''}`;
    case ActionType.Heal:            return `heal ${v}`;
    case ActionType.Buff:            return `+${v} atk${rounds ? ` · ${rounds}t` : ''}`;
    case ActionType.Debuff:          return `−${v} atk${rounds ? ` · ${rounds}t` : ''}`;
    case ActionType.Reflect:         return `reflect ${v}${rounds ? ` · ${rounds}t` : ''}`;
    case ActionType.MoveDebuff:      return `slow → ${v}${rounds ? ` · ${rounds}t` : ''}`;
    case ActionType.BlockTile:       return `block tile ${v}${tail}`;
    case ActionType.BuffTile:        return `buff tile +${v}${tail}`;
    case ActionType.HazardTile:      return `hazard tile ${v}${tail}`;
    case ActionType.SlowTile:        return `slow tile${tail}`;
    case ActionType.DestroyObstacle: return `destroy obstacle`;
    default:                         return '';
  }
}

// Per-category crit summary: the payload's action name(s) + a compact effect tag,
// e.g. "Snapback −28" or "Ebb +2 · Wane −7 atk". One crit list rides every action
// of its category, conditional on the triangle — so the panel shows it per group.
function critSummary(crits: Action[]): string | undefined {
  if (!crits || crits.length === 0) return undefined;
  const tag = (a: Action): string => {
    const f = (a as unknown as { field?: { field: number[] } }).field?.field;
    const v = (a as unknown as { value?: number }).value;
    switch (a.type) {
      case ActionType.Strike:          return `−${range(f ?? [])}`;
      case ActionType.DamageOverTime:  return `−${range(f ?? [])}/t`;
      case ActionType.Block:           return (v ?? 0) > 0 ? `block ${v}` : (a.cost < 0 ? `+${-a.cost}` : '');
      case ActionType.Shield:          return `shield ${v}`;
      case ActionType.Heal:            return `+${v} hp`;
      case ActionType.Buff:            return `+${v} atk`;
      case ActionType.Debuff:          return `−${v} atk`;
      case ActionType.Reflect:         return `reflect ${v}`;
      case ActionType.MoveDebuff:      return `slow ${v}`;
      default:                         return '';
    }
  };
  return crits.map(c => { const t = tag(c); return t ? `${c.name} ${t}` : c.name; }).join(' · ');
}

export function buildWeaponInfo(weapon: Weapon): WeaponInfo {
  // All aiming is uniform: any aimed action may pick its own square as the
  // target tile. Self-aimed strikes whiff via the friendly-fire guard in
  // resolution.ts; tiles (block/buff/hazard/slow) drop under the caster.
  const canSelf = (a: Action) => a.aimed;

  const toInfo = (a: Action, choice: 'defend' | 'attack' | 'special', i: number): ActionInfo => {
    const isSelf = SELF_TARGET_TYPES.has(a.type) && !a.targeted;
    return {
      label: a.name, choice, index: i,
      needsTarget: !isSelf && a.aimed,
      aimed: a.aimed, targeted: a.targeted,
      canTargetSelf: canSelf(a),
      targetsObstacle: a.type === ActionType.DestroyObstacle,
      range: a.range, cost: a.cost, stat: actionStat(a),
      area: a.area, push: a.push, smash: a.smash, moveTo: a.moveTo,
      // Reactive Area strike (not a tile / not a self-target): the block centers
      // on the actor, so the UI previews the footprint around the player itself.
      selfBurst: a.area > 1 && !a.aimed && !TILE_TYPES.has(a.type) && !(SELF_TARGET_TYPES.has(a.type) && !a.targeted),
    };
  };

  const actions: ActionInfo[] = [
    ...weapon.defend.map((a, i) => toInfo(a, 'defend', i)),
    ...weapon.attack.map((a, i) => toInfo(a, 'attack', i)),
    ...weapon.special.map((a, i) => toInfo(a, 'special', i)),
  ];

  const crits = {
    defend:  critSummary(weapon.defend_crit),
    attack:  critSummary(weapon.attack_crit),
    special: critSummary(weapon.special_crit),
  };

  return { name: weapon.name, resourceName: weapon.resource_name, maxResource: weapon.resource_max, actions, crits };
}

export function loadEnemy(file: string, options: {
  id: string;
  teamId: string;
  pos: { x: number; y: number };
  movementRange?: number;
  // Tutorial battles need a fixed starting pattern index so the lessons play
  // out in the order the YAML lays them out. Real hunts randomize so two of
  // the same enemy don't telegraph identical actions.
  randomizePatternStart?: boolean;
  // Scripted units (the tutorial bird) walk their fixed Pattern; everyone else
  // (the default) decides per-turn with the utility planner.
  scripted?: boolean;
}): { combatant: Combatant; meta: CombatantMeta; lootTable: LootTable } {
  const data = yaml.load(fs.readFileSync(file, 'utf-8')) as EnemyData;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weapon = Weapon.from_json(data.Weapon as any);
  const pattern = new Pattern(data.Pattern);
  const state = new CombatantState(
    data.Name,
    data.Health,
    weapon.resource_name,
    weapon.resource_max,
    data.Resistances ?? {},
  );

  const weaponInfo = buildWeaponInfo(weapon);

  const combatant: Combatant = {
    id: options.id,
    name: data.Name,
    hp: data.Health,
    maxHp: data.Health,
    resource: weapon.resource_max,
    maxResource: weapon.resource_max,
    resourceName: weapon.resource_name,
    pos: options.pos,
    movementRange: options.movementRange ?? 2,
    isAI: true,
    teamId: options.teamId,
    weaponInfo,
    weight: weapon.weight,
    initiative: 0,      // set by assignInitiative in CombatSession constructor
    initiativeRank: 0,  // set by assignInitiative in CombatSession constructor
  };

  // Start at a random index in the pattern so two of the same enemy on the
  // same board don't telegraph identical actions every turn — adds variety
  // and makes second-enemy spawns feel different from the first. Tutorials
  // opt out so the lesson plays in YAML order.
  const randomize = options.randomizePatternStart ?? true;
  const startIndex = randomize && pattern.field.length > 0
    ? Math.floor(Math.random() * pattern.field.length)
    : 0;

  const meta: CombatantMeta = {
    weapon,
    state,
    pattern: pattern.field,
    patternIndex: startIndex,
    scripted: options.scripted ?? false,
    telegraph: data.Telegraph,
  };

  const lootTable: LootTable = {
    currency: data.Loot?.Currency?.Field,
    items: (data.Loot?.Items ?? []).map(i => ({ id: i.id, type: i.type, field: i.Field })),
  };

  return { combatant, meta, lootTable };
}
