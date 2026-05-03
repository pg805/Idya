import yaml from 'js-yaml';
import fs from 'fs';
import Weapon from '../weapon/weapon.js';
import Pattern from '../infrastructure/pattern.js';
import { CombatantState } from './combatant_state.js';
import { Combatant, CombatantMeta, WeaponInfo, ActionInfo } from './combat_session.js';
import { SELF_TARGET_TYPES } from '../weapon/action.js';

type EnemyData = {
  Name: string;
  Health: number;
  Pattern: [number, number][];
  Weapon: Record<string, unknown>;
  Resistances?: Record<string, number>;
};

export function buildWeaponInfo(weapon: Weapon): WeaponInfo {
  const actions: ActionInfo[] = [];

  for (let i = 0; i < weapon.defend.length; i++) {
    const a = weapon.defend[i];
    const isSelf = SELF_TARGET_TYPES.has(a.type);
    actions.push({ label: a.name, choice: 'defend', index: i, needsTarget: !isSelf && a.aimed, aimed: a.aimed, range: a.range, cost: a.cost });
  }
  for (let i = 0; i < weapon.attack.length; i++) {
    const a = weapon.attack[i];
    const isSelf = SELF_TARGET_TYPES.has(a.type);
    actions.push({ label: a.name, choice: 'attack', index: i, needsTarget: !isSelf && a.aimed, aimed: a.aimed, range: a.range, cost: a.cost });
  }
  for (let i = 0; i < weapon.special.length; i++) {
    const a = weapon.special[i];
    const isSelf = SELF_TARGET_TYPES.has(a.type);
    actions.push({ label: a.name, choice: 'special', index: i, needsTarget: !isSelf && a.aimed, aimed: a.aimed, range: a.range, cost: a.cost });
  }

  return { name: weapon.name, resourceName: weapon.resource_name, maxResource: weapon.resource_max, actions };
}

export function loadEnemy(file: string, options: {
  id: string;
  teamId: string;
  pos: { x: number; y: number };
  movementRange?: number;
}): { combatant: Combatant; meta: CombatantMeta } {
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
  };

  const meta: CombatantMeta = {
    weapon,
    state,
    pattern: pattern.field,
    patternIndex: 0,
  };

  return { combatant, meta };
}
