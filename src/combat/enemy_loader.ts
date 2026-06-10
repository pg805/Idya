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
};

export function buildWeaponInfo(weapon: Weapon): WeaponInfo {
  const canSelf = (a: Action) => a.targeted && (a.type === ActionType.Heal || a.type === ActionType.Buff);

  const toInfo = (a: Action, choice: 'defend' | 'attack' | 'special', i: number): ActionInfo => {
    const isSelf = SELF_TARGET_TYPES.has(a.type) && !a.targeted;
    return {
      label: a.name, choice, index: i,
      needsTarget: !isSelf && a.aimed,
      aimed: a.aimed, targeted: a.targeted,
      canTargetSelf: canSelf(a),
      targetsObstacle: a.type === ActionType.DestroyObstacle,
      range: a.range, cost: a.cost,
      area: a.area, push: a.push, smash: a.smash,
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

  return { name: weapon.name, resourceName: weapon.resource_name, maxResource: weapon.resource_max, actions };
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
  };

  const lootTable: LootTable = {
    currency: data.Loot?.Currency?.Field,
    items: (data.Loot?.Items ?? []).map(i => ({ id: i.id, type: i.type, field: i.Field })),
  };

  return { combatant, meta, lootTable };
}
