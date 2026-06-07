import logger from '../utility/logger.js';
import Action, { ActionType } from '../weapon/action.js';
import Strike from '../weapon/action/strike.js';
import Damage_Over_Time from '../weapon/action/damage_over_time.js';
import Debuff from '../weapon/action/debuff.js';
import Block from '../weapon/action/block.js';
import Buff from '../weapon/action/buff.js';
import Heal from '../weapon/action/heal.js';
import Shield from '../weapon/action/shield.js';
import Reflect from '../weapon/action/reflect.js';
import { RollMode } from '../infrastructure/stance.js';
import { CombatantState } from './combatant_state.js';

function apply_self_actions(actor: CombatantState, actions: Action[]): string {
    let action_string = '';

    for (const action of actions) {
        if (action.type === ActionType.Block) {
            const resource_string = actor.apply_cost(action);
            actor.block = (action as Block).value;
            action_string += `\n<User> — ${action.name}${resource_string}\n  ${action.action_string.replace('<Damage>', `${actor.block}`)}`;
            logger.info(`Resolving ${actor.name} Block: ${action.name}\nValue: ${actor.block}`);
        }

        if (action.type === ActionType.Reflect) {
            const resource_string = actor.apply_cost(action);
            actor.reflect.value  = (action as Reflect).value;
            actor.reflect.rounds = (action as Reflect).rounds;
            action_string += `\n<User> — ${action.name}${resource_string}\n  ${action.action_string}`;
            logger.info(`Resolving ${actor.name} Reflect: ${action.name}\nValue: ${actor.reflect.value}  Rounds: ${actor.reflect.rounds}`);
        }

        if (action.type === ActionType.Shield) {
            const resource_string = actor.apply_cost(action);
            actor.shield.value  = (action as Shield).value;
            actor.shield.rounds = (action as Shield).rounds;
            action_string += `\n<User> — ${action.name}${resource_string}\n  ${action.action_string}`;
            logger.info(`Resolving ${actor.name} Shield: ${action.name}\nValue: ${actor.shield.value}  Rounds: ${actor.shield.rounds}`);
        }
    }

    return action_string;
}

function apply_hostile_actions(
    target: CombatantState,
    attacker: CombatantState,
    actions: Action[],
): { target_string: string; reflect: boolean } {
    let target_string = '';
    let reflect = false;

    for (const action of actions) {
        if (action.type === ActionType.Strike) {
            const resource_string = attacker.apply_cost(action);
            const type_string = action.damage_type ? `  |  ${action.damage_type} ${action.damage_subtype}` : '';
            reflect = true;
            const roll_mode = target.get_roll_mode(action);
            const damage_roll = (action as Strike).field.get_result_with_mode(roll_mode);
            const damage = Math.max(damage_roll - target.block - target.shield.value + attacker.buff.value + attacker.tileBuff - attacker.debuff.value, 0);
            const hp_before = target.health;
            target.health = Math.max(target.health - damage, 0);
            target.damage_taken += hp_before - target.health;

            const block_detail  = target.block + target.shield.value > 0 ? `  blocked ${target.block + target.shield.value}` : '';
            const buff_detail   = attacker.buff.value   ? `  +${attacker.buff.value} buff`    : '';
            const debuff_detail = attacker.debuff.value ? `  −${attacker.debuff.value} debuff` : '';
            const resist_detail = roll_mode !== RollMode.One
                ? `  [${roll_mode === RollMode.Hd4 ? 'weakness' : 'resist'} — ${roll_mode}]` : '';
            const detail = `\n  Roll: ${damage_roll}${block_detail}${buff_detail}${debuff_detail}${resist_detail}  →  ${damage} damage  |  <Target> HP: ${hp_before} → ${target.health}`;
            target_string += `\n<User> — ${action.name}${resource_string}${type_string}\n  ${action.action_string.replace('<Damage>', `${damage}`)}${detail}`;

            logger.info(`Resolving Strike on ${target.name}: ${action.name}\nRoll: ${damage_roll} (${roll_mode})  Block: ${target.block}  Shield: ${target.shield.value}  Buff: ${attacker.buff.value}  Debuff: ${attacker.debuff.value}  Damage: ${damage}  HP: ${target.health}`);
        }

        if (action.type === ActionType.DamageOverTime) {
            const resource_string = attacker.apply_cost(action);
            const type_string = action.damage_type ? `  |  ${action.damage_type} ${action.damage_subtype}` : '';
            const roll_mode = target.get_roll_mode(action);
            const damage = (action as Damage_Over_Time).field.get_result_with_mode(roll_mode);
            const rounds = (action as Damage_Over_Time).rounds;
            target.dot.value  = damage;
            target.dot.rounds = rounds;

            const resist_detail = roll_mode !== RollMode.One
                ? `  [${roll_mode === RollMode.Hd4 ? 'weakness' : 'resist'} — ${roll_mode}]` : '';
            const detail = `\n  DOT: ${damage} damage × ${rounds} rounds${resist_detail}`;
            target_string += `\n<User> — ${action.name}${resource_string}${type_string}\n  ${action.action_string.replace('<Damage>', `${damage}`)}${detail}`;

            logger.info(`Resolving DOT on ${target.name}: ${action.name}\nDamage: ${damage} (${roll_mode})  Rounds: ${rounds}`);
        }

        if (action.type === ActionType.Debuff) {
            const resource_string = attacker.apply_cost(action);
            const type_string = action.damage_type ? `  |  ${action.damage_type} ${action.damage_subtype}` : '';
            target.debuff.value  = (action as Debuff).value;
            target.debuff.rounds = (action as Debuff).rounds;
            target.buff.value  = 0;
            target.buff.rounds = 0;
            target_string += `\n<User> — ${action.name}${resource_string}${type_string}\n  ${action.action_string}`;
            logger.info(`Resolving Debuff on ${target.name}: ${action.name}\nValue: ${target.debuff.value}  Rounds: ${target.debuff.rounds}`);
        }

        if (action.type === ActionType.Buff) {
            const resource_string = attacker.apply_cost(action);
            target.buff.value  = (action as Buff).value;
            target.buff.rounds = (action as Buff).rounds;
            target.debuff.value  = 0;
            target.debuff.rounds = 0;
            target_string += `\n<User> — ${action.name}${resource_string}\n  ${action.action_string}`;
            logger.info(`Resolving ${attacker.name} Buff on ${target.name}: ${action.name}\nValue: ${target.buff.value}  Rounds: ${target.buff.rounds}`);
        }

        if (action.type === ActionType.Heal) {
            const resource_string = attacker.apply_cost(action);
            const heal = (action as Heal).value;
            const hp_before = target.health;
            target.health = Math.min(target.health + heal, target.max_health);
            target_string += `\n<User> — ${action.name}${resource_string}\n  ${action.action_string}  [HP: ${hp_before} → ${target.health}]`;
            logger.info(`Resolving ${attacker.name} Heal on ${target.name}: ${action.name}\nValue: ${heal}  HP: ${hp_before} → ${target.health}`);
        }
    }

    return { target_string, reflect };
}

function apply_reflect(actor: CombatantState, damage: number): string {
    if (damage <= 0) return '';
    const hp_before = actor.health;
    actor.health = Math.max(actor.health - damage, 0);
    actor.damage_taken += hp_before - actor.health;
    return `\n${damage} damage reflected to <User>  |  <User> HP: ${hp_before} → ${actor.health}`;
}

export function resolve_action(actor: CombatantState, target: CombatantState, actions: Action[]): string {
    const self_str = apply_self_actions(actor, actions);
    const { target_string, reflect } = apply_hostile_actions(target, actor, actions);
    const reflect_str = reflect ? apply_reflect(actor, target.reflect.value) : '';
    return `${self_str}${target_string}${reflect_str}`
        .replace(/<User>/g, actor.name)
        .replace(/<Target>/g, target.name);
}
