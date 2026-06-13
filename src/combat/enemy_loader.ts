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
const fieldList = (arr: number[]): string => {
  if (!arr.length) return '0';
  return arr.every(v => v === arr[0]) ? `${arr[0]}` : arr.join(', ');
};

// A concise, player-facing effect descriptor — a list of tokens, ` · `-joined
// (the client boxes each into an outline pill). Consistent shape: effect →
// modifiers (range / area / duration / riders) → field → resource refund.
// Tokens are spelled out (➜2 reach, "3 turns") rather than r2/3t. Crits reuse
// this same builder, so a crit reads exactly like a normal action.
function actionStat(a: Action, resourceName: string, isCrit = false): string {
  const f = (a as unknown as { field?: { field: number[] } }).field?.field;
  const v = (a as unknown as { value?: number }).value;
  const rounds = (a as unknown as { rounds?: number }).rounds;
  // Crits ride the triggering action's targeting, so aim / range / area / blink
  // are inherited and meaningless on a crit — suppress them there.
  const rng    = !isCrit && a.range > 1 && !a.moveTo ? `range ${a.range}` : '';
  const area   = !isCrit && a.area > 1 ? `${a.area}×${a.area}` : '';
  const turns  = rounds ? `${rounds} turns` : '';
  const blink  = !isCrit && a.moveTo ? 'blink' : '';
  const knock  = a.push > 0 ? 'knockback' : '';
  const aim    = isCrit ? '' : (a.aimed ? 'aimed' : 'reactive');   // aimed = pick a tile, reactive = auto-fires
  // A negative cost on a non-restore action refunds resource as a side effect.
  const refund = a.cost < 0 && a.type !== ActionType.Block ? `+${-a.cost} ${resourceName}` : '';
  const j = (...parts: string[]): string => parts.filter(Boolean).join(' · ');
  // Standardized: lead with the capitalized TYPE, then value / field / modifiers.
  switch (a.type) {
    case ActionType.Strike:          return j('Strike', aim, area, rng, blink, knock, fieldList(f ?? []), refund);
    case ActionType.DamageOverTime:  return j('DOT', aim, rng, area, turns, fieldList(f ?? []), refund);
    // A value-0 Block is a pure resource-restore — the cost pill already shows
    // the "+N" gain, so leave the stat empty rather than a redundant "Restore N".
    case ActionType.Block:           return (v ?? 0) > 0 ? `Block ${v}` : '';
    case ActionType.Shield:          return j(`Shield ${v}`, turns, refund);
    case ActionType.Heal:            return j(`Heal ${v}`, refund);
    case ActionType.Buff:            return j(`Buff ${v}`, turns, refund);
    case ActionType.Debuff:          return j(`Debuff ${v}`, turns, refund);
    case ActionType.Reflect:         return j(`Reflect ${v}`, turns, refund);
    case ActionType.MoveDebuff:      return j(`Slow ${v}`, turns, refund);
    case ActionType.BlockTile:       return j(`Block Tile ${v}`, rng, area);
    case ActionType.BuffTile:        return j(`Buff Tile ${v}`, rng, area);
    case ActionType.HazardTile:      return j(`Hazard Tile ${v}`, rng, area);
    case ActionType.SlowTile:        return j('Slow Tile', rng, area);
    case ActionType.DestroyObstacle: return j('Destroy', rng);
    default:                         return '';
  }
}

// Per-category crit summary: one entry per action in the crit payload, each with
// its name + the SAME stat format as a normal action (so a crit reads identically
// — e.g. Wane → { name: 'Wane', stat: '−7 atk · 4 turns · +2 Flow' }). One crit
// list rides every action of its category, conditional on the triangle.
function critSummary(crits: Action[], resourceName: string): { name: string; stat: string }[] | undefined {
  if (!crits || crits.length === 0) return undefined;
  return crits.map(c => ({ name: c.name, stat: actionStat(c, resourceName, true) }));
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
      range: a.range, cost: a.cost, stat: actionStat(a, weapon.resource_name),
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
    defend:  critSummary(weapon.defend_crit,  weapon.resource_name),
    attack:  critSummary(weapon.attack_crit,  weapon.resource_name),
    special: critSummary(weapon.special_crit, weapon.resource_name),
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
