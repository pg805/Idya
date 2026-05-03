import logger from '../utility/logger.js';

import Player_Character from '../character/player_character.js';
import Non_Player_Character from '../character/non_player_character.js';
import Action, { ActionType } from '../weapon/action.js';
import Strike from '../weapon/action/strike.js';
import Damage_Over_Time from '../weapon/action/damage_over_time.js';
import Debuff from '../weapon/action/debuff.js';
import Block from '../weapon/action/block.js';
import Buff from '../weapon/action/buff.js';
import Heal from '../weapon/action/heal.js';
import Shield from '../weapon/action/shield.js';
import Reflect from '../weapon/action/reflect.js';
import { Stance, RollMode, resolve_roll_mode, stance_label } from '../infrastructure/stance.js';
import { PatternActionType } from '../infrastructure/pattern.js';

interface StatusEffect {
    value: number;
    rounds: number;
}

class CombatantState {
    name: string
    health: number
    max_health: number
    resource_name: string
    resource_max: number
    resource_current: number
    resistances: Record<string, number>
    stance: Stance = Stance.Balanced
    block = 0
    dot:     StatusEffect = { value: 0, rounds: 0 }
    buff:    StatusEffect = { value: 0, rounds: 0 }
    debuff:  StatusEffect = { value: 0, rounds: 0 }
    reflect: StatusEffect = { value: 0, rounds: 0 }
    shield:  StatusEffect = { value: 0, rounds: 0 }

    constructor(name: string, health: number, resource_name: string, resource_max: number, resistances: Record<string, number> = {}) {
        this.name = name;
        this.health = health;
        this.max_health = health;
        this.resource_name = resource_name;
        this.resource_max = resource_max;
        this.resource_current = resource_max;
        this.resistances = resistances;
    }

    get_resistance_modifier(action: Action): number {
        let modifier = 1.0;
        const main = this.resistances[action.damage_type];
        if (main !== undefined) modifier *= main;
        const sub = this.resistances[action.damage_subtype];
        if (sub !== undefined) modifier *= sub;
        return modifier;
    }

    apply_cost(action: Action): string {
        if (action.cost === 0) return '';
        const before = this.resource_current;
        this.resource_current = Math.max(0, Math.min(this.resource_max, this.resource_current - action.cost));
        return `  [${this.resource_name}: ${before} → ${this.resource_current}]`;
    }

    private tick_effect(effect: StatusEffect, label: string): string {
        if (effect.rounds <= 0) return '';
        effect.rounds -= 1;
        if (effect.rounds === 0) effect.value = 0;
        logger.info(`${label} rounds for ${this.name}: ${effect.rounds}`);
        return `\n${this.name} has ${effect.rounds} round(s) left on their ${label}.`;
    }

    end_round() {
        let action_string = '';

        this.block = 0;

        if (this.dot.rounds > 0) {
            const hp_before = this.health;
            this.health = Math.max(this.health - this.dot.value, 0);
            this.dot.rounds -= 1;
            action_string += `\n${this.name} takes ${this.dot.value} DOT damage  (${this.dot.rounds} round(s) remaining)  |  HP: ${hp_before} → ${this.health}`;
            logger.info(
                `End of Turn DOT on ${this.name}
Damage: ${this.dot.value}
Rounds Left: ${this.dot.rounds}
Health: ${this.health}
`
            );
            if (this.dot.rounds === 0) this.dot.value = 0;
        }

        action_string += this.tick_effect(this.buff,    'buff');
        action_string += this.tick_effect(this.debuff,  'debuff');
        action_string += this.tick_effect(this.reflect, 'reflect');
        action_string += this.tick_effect(this.shield,  'shield');

        return action_string;
    }
}

export default class Battle {
    player_character: Player_Character
    non_player_character: Non_Player_Character
    pc_object: CombatantState
    npc_object: CombatantState
    npc_index = 0;
    npc_stance_index = 0;
    current_round = 1;
    complete = false;
    winner = '';
    log: Array<string> = []

    constructor(player_character: Player_Character, non_player_character: Non_Player_Character) {
        this.player_character = player_character;
        this.non_player_character = non_player_character;
        this.pc_object = new CombatantState(
            player_character.name,
            player_character.health,
            player_character.weapon.resource_name,
            player_character.weapon.resource_max
        );
        this.npc_object = new CombatantState(
            non_player_character.name,
            non_player_character.health,
            non_player_character.weapon.resource_name,
            non_player_character.weapon.resource_max,
            non_player_character.resistances
        );
    }

    check_winners() {
        if (this.pc_object.health === 0 && this.npc_object.health === 0) {
            return this.non_player_character.name;
        }
        if (this.pc_object.health === 0) {
            return this.non_player_character.name;
        }
        if (this.npc_object.health === 0) {
            return this.player_character.name;
        }
        return '';
    }

    /** Returns the next NPC action info accounting for resource affordability, for telegraphing. */
    get_next_npc_entry(): { type: PatternActionType | null, stance: Stance } {
        const result = this.find_affordable_npc_entry();
        if (result === null) {
            return { type: null, stance: this.non_player_character.stance_pattern[this.npc_stance_index] };
        }
        return {
            type:   this.non_player_character.pattern.field[result.pattern_index].type,
            stance: this.non_player_character.stance_pattern[result.stance_index]
        };
    }

    private find_affordable_npc_entry(): { pattern_index: number, stance_index: number, steps_skipped: number } | null {
        const weapon      = this.non_player_character.weapon;
        const pattern_len = this.non_player_character.pattern.length;
        const stance_len  = this.non_player_character.stance_pattern.length;

        for (let i = 0; i < pattern_len; i++) {
            const pidx  = (this.npc_index + i) % pattern_len;
            const entry = this.non_player_character.pattern.field[pidx];

            let action: Action | null = null;
            if      (entry.type === PatternActionType.Defend)  action = weapon.defend[entry.index]  ?? null;
            else if (entry.type === PatternActionType.Attack)  action = weapon.attack[entry.index]  ?? null;
            else if (entry.type === PatternActionType.Special) action = weapon.special[entry.index] ?? null;

            if (action !== null && action.cost <= this.npc_object.resource_current) {
                return { pattern_index: pidx, stance_index: (this.npc_stance_index + i) % stance_len, steps_skipped: i };
            }
        }

        return null;
    }

    private apply_self_actions(actor: CombatantState, actions: Action[]): string {
        let action_string = '';

        for (const action of actions) {
            if (action.type === ActionType.Block) {
                const resource_string = actor.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                const block = (action as Block).value;
                actor.block = block;
                action_string += `${header}\n  ${action.action_string}`;
                logger.info(`Resolving ${actor.name} Block: ${action.name}\nValue: ${block}`);
            }

            if (action.type === ActionType.Buff) {
                const resource_string = actor.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                actor.buff.value  = (action as Buff).value;
                actor.buff.rounds = (action as Buff).rounds;
                actor.debuff.value  = 0;
                actor.debuff.rounds = 0;
                action_string += `${header}\n  ${action.action_string}`;
                logger.info(`Resolving ${actor.name} Buff: ${action.name}\nValue: ${actor.buff.value}  Rounds: ${actor.buff.rounds}`);
            }

            if (action.type === ActionType.Heal) {
                const resource_string = actor.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                const heal = (action as Heal).value;
                const hp_before = actor.health;
                actor.health = Math.min(actor.health + heal, actor.max_health);
                action_string += `${header}\n  ${action.action_string}  [HP: ${hp_before} → ${actor.health}]`;
                logger.info(`Resolving ${actor.name} Heal: ${action.name}\nValue: ${heal}  HP: ${hp_before} → ${actor.health}`);
            }

            if (action.type === ActionType.Reflect) {
                const resource_string = actor.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                actor.reflect.value  = (action as Reflect).value;
                actor.reflect.rounds = (action as Reflect).rounds;
                action_string += `${header}\n  ${action.action_string}`;
                logger.info(`Resolving ${actor.name} Reflect: ${action.name}\nValue: ${actor.reflect.value}  Rounds: ${actor.reflect.rounds}`);
            }

            if (action.type === ActionType.Shield) {
                const resource_string = actor.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                actor.shield.value  = (action as Shield).value;
                actor.shield.rounds = (action as Shield).rounds;
                action_string += `${header}\n  ${action.action_string}`;
                logger.info(`Resolving ${actor.name} Shield: ${action.name}\nValue: ${actor.shield.value}  Rounds: ${actor.shield.rounds}`);
            }
        }

        return action_string;
    }

    private apply_hostile_actions(target: CombatantState, attacker: CombatantState, actions: Action[], roll_mode: RollMode): { target_string: string, reflect: boolean } {
        let target_string = '';
        let reflect = false;

        for (const action of actions) {
            if (action.type === ActionType.Strike) {
                const resource_string = attacker.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                reflect = true;
                const damage_roll: number = (action as Strike).field.get_result_with_mode(roll_mode);
                const raw_damage: number = Math.max(damage_roll - target.block - target.shield.value + attacker.buff.value - attacker.debuff.value, 0);
                const resistance_modifier: number = target.get_resistance_modifier(action);
                const damage: number = Math.floor(raw_damage * resistance_modifier);
                const hp_before = target.health;
                target.health = Math.max(target.health - damage, 0);

                const block_detail  = target.block + target.shield.value > 0 ? `  blocked ${target.block + target.shield.value}` : '';
                const buff_detail   = attacker.buff.value   ? `  +${attacker.buff.value} buff`   : '';
                const debuff_detail = attacker.debuff.value ? `  −${attacker.debuff.value} debuff` : '';
                const resist_detail = resistance_modifier !== 1.0 ? `  ×${resistance_modifier} ${resistance_modifier > 1 ? 'weakness' : 'resist'}` : '';
                const detail = `\n  Roll: ${damage_roll}${block_detail}${buff_detail}${debuff_detail}${resist_detail}  →  ${damage} damage  |  ${target.name} HP: ${hp_before} → ${target.health}`;

                target_string += `${header}\n  ${action.action_string.replace('<Damage>', `${damage}`)}${detail}`;

                logger.info(`Resolving Strike on ${target.name}: ${action.name}\nRoll: ${damage_roll}  Block: ${target.block}  Shield: ${target.shield.value}  Buff: ${attacker.buff.value}  Debuff: ${attacker.debuff.value}  Modifier: ${resistance_modifier}  Damage: ${damage}  HP: ${target.health}`);
            }

            if (action.type === ActionType.DamageOverTime) {
                const resource_string = attacker.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                const raw_damage: number = (action as Damage_Over_Time).field.get_result_with_mode(roll_mode);
                const resistance_modifier: number = target.get_resistance_modifier(action);
                const damage: number = Math.floor(raw_damage * resistance_modifier);
                const rounds: number = (action as Damage_Over_Time).rounds;
                target.dot.value  = damage;
                target.dot.rounds = rounds;

                const resist_detail = resistance_modifier !== 1.0 ? `  ×${resistance_modifier} ${resistance_modifier > 1 ? 'weakness' : 'resist'}` : '';
                const detail = `\n  DOT: ${damage} damage × ${rounds} rounds${resist_detail}`;

                target_string += `${header}\n  ${action.action_string.replace('<Damage>', `${damage}`)}${detail}`;

                logger.info(`Resolving DOT on ${target.name}: ${action.name}\nDamage: ${damage}  Modifier: ${resistance_modifier}  Rounds: ${rounds}`);
            }

            if (action.type === ActionType.Debuff) {
                const resource_string = attacker.apply_cost(action);
                const header = `\n<User> — ${action.name}${resource_string}`;
                target.debuff.value  = (action as Debuff).value;
                target.debuff.rounds = (action as Debuff).rounds;
                target.buff.value  = 0;
                target.buff.rounds = 0;
                target_string += `${header}\n  ${action.action_string}`;
                logger.info(`Resolving Debuff on ${target.name}: ${action.name}\nValue: ${target.debuff.value}  Rounds: ${target.debuff.rounds}`);
            }
        }

        return { target_string, reflect };
    }

    private apply_reflect(actor: CombatantState, damage: number): string {
        const hp_before = actor.health;
        actor.health = Math.max(actor.health - damage, 0);

        const action_string = damage > 0 ? `\n${damage} damage reflected to <User>  |  <User> HP: ${hp_before} → ${actor.health}` : '';

        logger.info(
            `Reflecting Damage to ${actor.name}
Damage: ${damage}
Health: ${actor.health}
`);

        return action_string;
    }

    private resolve_action(actor: CombatantState, opponent: CombatantState, actions: Action[], roll_mode: RollMode): string {
        const self_str = this.apply_self_actions(actor, actions);
        const { target_string, reflect } = this.apply_hostile_actions(opponent, actor, actions, roll_mode);
        const reflect_str = reflect ? this.apply_reflect(actor, opponent.reflect.value) : '';
        return `${self_str}${target_string}${reflect_str}`
            .replace(/<User>/g, actor.name)
            .replace(/<Target>/g, opponent.name);
    }

    resolve_round(player_action: PatternActionType, player_action_index: number = 0, player_stance: Stance = Stance.Balanced) {
        const npc_result = this.find_affordable_npc_entry();
        const npc_passes           = npc_result === null;
        const npc_pattern_index    = npc_result?.pattern_index    ?? this.npc_index;
        const npc_stance_index_eff = npc_result?.stance_index     ?? this.npc_stance_index;
        const steps_skipped        = npc_result?.steps_skipped    ?? 0;
        const npc_action: PatternActionType = npc_passes ? PatternActionType.None : this.non_player_character.pattern.field[npc_pattern_index].type;
        const npc_action_index: number      = npc_passes ? 0 : this.non_player_character.pattern.field[npc_pattern_index].index;
        const npc_stance: Stance = this.non_player_character.stance_pattern[npc_stance_index_eff];

        this.pc_object.stance  = player_stance;
        this.npc_object.stance = npc_stance;

        const pc_roll_mode:  RollMode = resolve_roll_mode(player_stance, npc_stance);
        const npc_roll_mode: RollMode = resolve_roll_mode(npc_stance, player_stance);

        let action_string: string = `Round ${this.current_round} — ${this.pc_object.name}: ${stance_label[player_stance]}  |  ${this.npc_object.name}: ${stance_label[npc_stance]}`;
        if (npc_passes) {
            action_string += `\n${this.npc_object.name} is exhausted and passes their turn.`;
        } else if (steps_skipped > 0) {
            const type_name = npc_action === PatternActionType.Defend ? 'defend' : npc_action === PatternActionType.Attack ? 'attack' : 'special';
            action_string += `\n${this.npc_object.name} can't afford their planned move (${this.npc_object.resource_name} depleted) — falls back to ${type_name}.`;
        }

        logger.info(
            `***************************
Resolving Turn
Current Round: ${this.current_round}
Player Health: ${this.pc_object.health}
Non Player Health: ${this.npc_object.health}
Player Action: ${player_action}
Player Stance: ${player_stance} (roll mode: ${pc_roll_mode})
Non Player Character Action: ${npc_action}
NPC Stance: ${npc_stance} (roll mode: ${npc_roll_mode})
`
        );

        if (player_action === PatternActionType.Defend) {
            action_string += this.resolve_action(
                this.pc_object, this.npc_object,
                [this.player_character.weapon.defend[player_action_index]],
                pc_roll_mode
            );
        }

        if (npc_action === PatternActionType.Defend) {
            action_string += this.resolve_action(
                this.npc_object, this.pc_object,
                [this.non_player_character.weapon.defend[npc_action_index]],
                npc_roll_mode
            );
        }

        // Check For Winners
        this.winner = this.check_winners();
        if (this.winner) {
            this.log.push(action_string);
            return { action_string, winner: this.winner };
        }

        if (player_action === PatternActionType.Attack) {
            if (npc_action === PatternActionType.Special) {
                action_string += this.resolve_action(
                    this.pc_object, this.npc_object,
                    this.player_character.weapon.attack_crit,
                    pc_roll_mode
                );
            }
            action_string += this.resolve_action(
                this.pc_object, this.npc_object,
                [this.player_character.weapon.attack[player_action_index]],
                pc_roll_mode
            );
        }

        if (npc_action === PatternActionType.Attack) {
            if (player_action === PatternActionType.Special) {
                action_string += this.resolve_action(
                    this.npc_object, this.pc_object,
                    this.non_player_character.weapon.attack_crit,
                    npc_roll_mode
                );
            }
            action_string += this.resolve_action(
                this.npc_object, this.pc_object,
                [this.non_player_character.weapon.attack[npc_action_index]],
                npc_roll_mode
            );
        }

        // Check For Winners
        this.winner = this.check_winners();
        if (this.winner) {
            this.log.push(action_string);
            return { action_string, winner: this.winner };
        }

        if (player_action === PatternActionType.Special) {
            action_string += this.resolve_action(
                this.pc_object, this.npc_object,
                [this.player_character.weapon.special[player_action_index]],
                pc_roll_mode
            );
        }

        if (npc_action === PatternActionType.Special) {
            action_string += this.resolve_action(
                this.npc_object, this.pc_object,
                [this.non_player_character.weapon.special[npc_action_index]],
                npc_roll_mode
            );
        }

        // Check For Winners
        this.winner = this.check_winners();
        if (this.winner) {
            this.log.push(action_string);
            return { action_string, winner: this.winner };
        }

        // Round End Updating
        this.current_round += 1;
        this.npc_index = (npc_pattern_index + 1) % this.non_player_character.pattern.length;
        this.npc_stance_index = (npc_stance_index_eff + 1) % this.non_player_character.stance_pattern.length;
        const pc_end_string: string  = this.pc_object.end_round();
        const npc_end_string: string = this.npc_object.end_round();

        action_string += pc_end_string.replace(/<User>/g, this.pc_object.name);
        action_string += npc_end_string.replace(/<User>/g, this.npc_object.name);

        this.winner = this.check_winners();

        this.log.push(action_string);
        return { action_string, winner: this.winner };
    }
}
