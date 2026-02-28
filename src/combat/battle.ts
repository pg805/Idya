import logger from '../utility/logger.js';

import Player_Character from '../character/player_character.js';
import Non_Player_Character from '../character/non_player_character.js';
import Action from '../weapon/action.js';
import Strike from '../weapon/action/strike.js';
import Damage_Over_Time from '../weapon/action/damage_over_time.js';
import Debuff from '../weapon/action/debuff.js';
import Block from '../weapon/action/block.js';
import Buff from '../weapon/action/buff.js';
import Heal from '../weapon/action/heal.js';
import Shield from '../weapon/action/shield.js';
import Reflect from '../weapon/action/reflect.js';
import { Stance, RollMode, resolve_roll_mode, stance_label } from '../infrastructure/stance.js';

class Player_Object {
    name: string
    health: number
    max_health: number // TODO, add to constructor
    resource_name: string
    resource_max: number
    resource_current: number
    resistances: Record<string, number>
    stance: Stance = Stance.Balanced
    block = 0
    damage_over_time_value = 0
    damage_over_time_rounds = 0
    buff_value = 0
    buff_rounds = 0
    debuff_value = 0
    debuff_rounds = 0
    reflect_value = 0 // TODO, add to attack
    reflect_rounds = 0
    shield_value = 0
    shield_rounds = 0

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

    target_self(action_array: Array<Action>) {
        let action_string = '';

        action_array.forEach((action: Action) => {
            const resource_string = this.apply_cost(action);
            const header = `\n<User> — ${action.name}${resource_string}`;

            // Block
            if (action.type == 2) {
                const block = (<Block>action).value;
                this.block = block;

                action_string = `${action_string}${header}\n  ${action.action_string}`;

                logger.info(`Resolving ${this.name} Block: ${action.name}\nValue: ${block}`);
            }

            // Buff
            if (action.type == 3) {
                const buff_value = (<Buff>action).value;
                this.buff_value = buff_value;
                const buff_rounds = (<Buff>action).rounds;
                this.buff_rounds = buff_rounds;
                this.debuff_value = 0;
                this.debuff_rounds = 0;

                action_string = `${action_string}${header}\n  ${action.action_string}`;

                logger.info(`Resolving ${this.name} Buff: ${action.name}\nValue: ${buff_value}  Rounds: ${buff_rounds}`);
            }

            // Heal
            if (action.type == 6) {
                const heal = (<Heal>action).value;
                const hp_before = this.health;
                this.health = Math.min(this.health + heal, this.max_health);

                action_string = `${action_string}${header}\n  ${action.action_string}  [HP: ${hp_before} → ${this.health}]`;

                logger.info(`Resolving ${this.name} Heal: ${action.name}\nValue: ${heal}  HP: ${hp_before} → ${this.health}`);
            }

            // Reflect
            if (action.type == 7) {
                const reflect_value = (<Reflect>action).value;
                this.reflect_value = reflect_value;
                const reflect_rounds = (<Reflect>action).rounds;
                this.reflect_rounds = reflect_rounds;

                action_string = `${action_string}${header}\n  ${action.action_string}`;

                logger.info(`Resolving ${this.name} Reflect: ${action.name}\nValue: ${reflect_value}  Rounds: ${reflect_rounds}`);
            }

            // Shield
            if (action.type == 8) {
                const shield_value = (<Shield>action).value;
                this.shield_value = shield_value;
                const shield_rounds = (<Shield>action).rounds;
                this.shield_rounds = shield_rounds;

                action_string = `${action_string}${header}\n  ${action.action_string}`;

                logger.info(`Resolving ${this.name} Shield: ${action.name}\nValue: ${shield_value}  Rounds: ${shield_rounds}`);
            }
        });

        return action_string
    }

    hostile_target(action_array: Array<Action>, hostile_object: Player_Object, roll_mode: RollMode = RollMode.One) {
        let target_string = '';
        let reflect = false;

        action_array.forEach((action: Action) => {
            const resource_string = hostile_object.apply_cost(action);
            const type_string = action.damage_type ? `  |  ${action.damage_type} ${action.damage_subtype}` : '';
            const header = `\n<User> — ${action.name}${resource_string}${type_string}`;

            // Strike
            if (action.type == 1) {
                reflect = true;
                const damage_roll: number = (<Strike>action).field.get_result_with_mode(roll_mode);
                const raw_damage: number = Math.max(damage_roll - this.block - this.shield_value + hostile_object.buff_value - hostile_object.debuff_value, 0);
                const resistance_modifier: number = this.get_resistance_modifier(action);
                const damage: number = Math.floor(raw_damage * resistance_modifier);
                const hp_before = this.health;
                this.health = Math.max(this.health - damage, 0);

                const block_detail  = this.block + this.shield_value > 0 ? `  blocked ${this.block + this.shield_value}` : '';
                const buff_detail   = hostile_object.buff_value  ? `  +${hostile_object.buff_value} buff` : '';
                const debuff_detail = hostile_object.debuff_value ? `  −${hostile_object.debuff_value} debuff` : '';
                const resist_detail = resistance_modifier !== 1.0 ? `  ×${resistance_modifier} ${resistance_modifier > 1 ? 'weakness' : 'resist'}` : '';
                const detail = `\n  Roll: ${damage_roll}${block_detail}${buff_detail}${debuff_detail}${resist_detail}  →  ${damage} damage  |  ${this.name} HP: ${hp_before} → ${this.health}`;

                target_string = `${target_string}${header}\n  ${action.action_string.replace('<Damage>', `${damage}`)}${detail}`;

                logger.info(`Resolving Strike on ${this.name}: ${action.name}\nRoll: ${damage_roll}  Block: ${this.block}  Shield: ${this.shield_value}  Buff: ${hostile_object.buff_value}  Debuff: ${hostile_object.debuff_value}  Modifier: ${resistance_modifier}  Damage: ${damage}  HP: ${this.health}`);
            }

            // DOT
            if (action.type == 4) {
                const raw_damage: number = (<Damage_Over_Time>action).field.get_result_with_mode(roll_mode);
                const resistance_modifier: number = this.get_resistance_modifier(action);
                const damage: number = Math.floor(raw_damage * resistance_modifier);
                const rounds: number = (<Damage_Over_Time>action).rounds;
                this.damage_over_time_value = damage;
                this.damage_over_time_rounds = rounds;

                const resist_detail = resistance_modifier !== 1.0 ? `  ×${resistance_modifier} ${resistance_modifier > 1 ? 'weakness' : 'resist'}` : '';
                const detail = `\n  DOT: ${damage} damage × ${rounds} rounds${resist_detail}`;

                target_string = `${target_string}${header}\n  ${action.action_string.replace('<Damage>', `${damage}`)}${detail}`;

                logger.info(`Resolving DOT on ${this.name}: ${action.name}\nDamage: ${damage}  Modifier: ${resistance_modifier}  Rounds: ${rounds}`);
            }

            // Debuff
            if (action.type == 5) {
                const debuff = (<Debuff>action).value;
                const rounds = (<Debuff>action).rounds;
                this.debuff_value = debuff;
                this.debuff_rounds = rounds;
                this.buff_value = 0;
                this.buff_rounds = 0;

                target_string = `${target_string}${header}\n  ${action.action_string}`;

                logger.info(`Resolving Debuff on ${this.name}: ${action.name}\nValue: ${debuff}  Rounds: ${rounds}`);
            }
        });

        return {target_string, reflect};
    }

    handle_reflect(damage: number) {
        const hp_before = this.health;
        this.health = Math.max(this.health - damage, 0);

        const action_string = damage > 0 ? `\n${damage} damage reflected to <User>  |  <User> HP: ${hp_before} → ${this.health}` : '';

        logger.info(
            `Reflecting Damage to ${this.name}
Damage: ${damage}
Health: ${this.health}
`);

        return action_string
    }

    end_round() {

        let action_string: string = '';

        this.block = 0;

        // Damage over Time
        if (this.damage_over_time_rounds > 0) {
            const hp_before = this.health;
            this.health = Math.max(this.health - this.damage_over_time_value, 0);
            this.damage_over_time_rounds -= 1;

            action_string = `${action_string}\n${this.name} takes ${this.damage_over_time_value} DOT damage  (${this.damage_over_time_rounds} round(s) remaining)  |  HP: ${hp_before} → ${this.health}`;

            logger.info(
                `End of Turn DOT on ${this.name}
Damage: ${this.damage_over_time_value}
Rounds Left: ${this.damage_over_time_rounds}
Health: ${this.health}
`
            );
            if (this.damage_over_time_rounds == 0) {
                this.damage_over_time_value = 0;
            }
        } else {
            this.damage_over_time_rounds = 0;
            this.damage_over_time_value = 0;
        }

        // Reduce Buff Rounds
        if (this.buff_rounds > 0) {
            this.buff_rounds -= 1;

            action_string = `${action_string}\n${this.name} has ${this.buff_rounds} round(s) left on their buff.`;

            logger.info(`Buff Rounds for ${this.name}: ${this.buff_rounds}`);
            if (this.buff_rounds == 0) {
                this.buff_value = 0;
            }
        } else {
            this.buff_rounds = 0;
            this.buff_value = 0;
        }

        // Reduce Debuff Rounds
        if (this.debuff_rounds > 0) {
            this.debuff_rounds -= 1;

            action_string = `${action_string}\n${this.name} has ${this.debuff_rounds} round(s) left on their debuff.`;

            logger.info(`Debuff Rounds for ${this.name}: ${this.debuff_rounds}`);
            if (this.debuff_rounds == 0) {
                this.debuff_value = 0;
            }
        } else {
            this.debuff_rounds = 0;
            this.debuff_value = 0;
        }

        // Reduce Reflect Rounds
        if (this.reflect_rounds > 0) {
            this.reflect_rounds -= 1;

            action_string = `${action_string}\n${this.name} has ${this.reflect_rounds} round(s) left on their reflect.`;

            logger.info(`Reflect Rounds for ${this.name}: ${this.reflect_rounds}`);
            if (this.reflect_rounds == 0) {
                this.reflect_value = 0;
            }
        } else {
            this.reflect_rounds = 0;
            this.reflect_value = 0;
        }

        // Reduce Shield Rounds
        if (this.shield_rounds > 0) {
            this.shield_rounds -= 1;

            action_string = `${action_string}\n${this.name} has ${this.shield_rounds} round(s) left on their shield.`;

            logger.info(`Shield Rounds for ${this.name}: ${this.shield_rounds}`);
            if (this.shield_rounds == 0) {
                this.shield_value = 0;
            }
        } else {
            this.shield_rounds = 0;
            this.shield_value = 0;
        }

        return action_string
    }
}

export default class Battle {
    player_character: Player_Character
    non_player_character: Non_Player_Character
    pc_object: Player_Object
    npc_object: Player_Object
    npc_index = 0;
    npc_stance_index = 0;
    current_round = 1;
    complete = false;
    winner = '';
    log: Array<string> = []


    constructor(player_character: Player_Character, non_player_character: Non_Player_Character) {
        this.player_character = player_character;
        this.non_player_character = non_player_character;
        this.pc_object = new Player_Object(
            player_character.name,
            player_character.health,
            player_character.weapon.resource_name,
            player_character.weapon.resource_max
        );
        this.npc_object = new Player_Object(
            non_player_character.name,
            non_player_character.health,
            non_player_character.weapon.resource_name,
            non_player_character.weapon.resource_max,
            non_player_character.resistances
        );
    }

    check_winners() {
        // Specify Tie
        if (this.pc_object.health == 0 && this.npc_object.health == 0) {
            return this.non_player_character.name;
        }

        // NPC Win
        if (this.pc_object.health == 0) {
            return this.non_player_character.name;
        }

        // PC Win
        if (this.npc_object.health == 0) {
            return this.player_character.name;
        }

        return '';
    }

    resolve_round(player_action: number, player_action_index: number = 0, player_stance: Stance = Stance.Balanced) {
        const npc_stance: Stance = this.non_player_character.stance_pattern[this.npc_stance_index];

        this.pc_object.stance  = player_stance;
        this.npc_object.stance = npc_stance;

        const pc_roll_mode:  RollMode = resolve_roll_mode(player_stance, npc_stance);
        const npc_roll_mode: RollMode = resolve_roll_mode(npc_stance, player_stance);

        let action_string: string = `Round ${this.current_round} — ${this.pc_object.name}: ${stance_label[player_stance]}  |  ${this.npc_object.name}: ${stance_label[npc_stance]}`
        const npc_pattern_entry = this.non_player_character.pattern.field[this.npc_index];
        const npc_action: number = npc_pattern_entry.type;
        const npc_action_index: number = npc_pattern_entry.index;
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


        if (player_action == 1) {
            const player_defend = [this.player_character.weapon.defend[player_action_index]];
            const self_string = this.pc_object.target_self(player_defend);
            const { target_string, reflect } = this.npc_object.hostile_target(player_defend, this.pc_object, pc_roll_mode);
            let reflect_string: string = ''

            if (reflect) {
                reflect_string = this.pc_object.handle_reflect(this.npc_object.reflect_value);
            }

            action_string = `${action_string}${
                self_string.replace(/\<User\>/g, this.pc_object.name)
            }${
                target_string.replace(/\<User\>/g, this.pc_object.name).replace(/\<Target\>/g, this.npc_object.name)
            }${
                reflect_string.replace(/\<User\>/g, this.pc_object.name)
            }`
        }

        if (npc_action == 1) {
            const npc_defend = [this.non_player_character.weapon.defend[npc_action_index]];
            const self_string = this.npc_object.target_self(npc_defend);
            const { target_string, reflect } = this.pc_object.hostile_target(npc_defend, this.npc_object, npc_roll_mode);
            let reflect_string: string = ''
            if (reflect) {
                reflect_string = this.npc_object.handle_reflect(this.pc_object.reflect_value);
            }

            action_string = `${action_string}${
                self_string.replace(/\<User\>/g, this.npc_object.name)
            }${
                target_string.replace(/\<User\>/g, this.npc_object.name).replace(/\<Target\>/g, this.pc_object.name)
            }${
                reflect_string.replace(/\<User\>/g, this.npc_object.name)
            }`
        }

        // Check For Winners
        this.winner = this.check_winners();
        if (this.winner) {
            this.log.push(action_string);
            const winner: string = this.winner
            return { action_string, winner };
        }

        if (player_action == 2) {
            if (npc_action == 3) {
                const self_string = this.pc_object.target_self(this.player_character.weapon.attack_crit);
                const {target_string, reflect} = this.npc_object.hostile_target(this.player_character.weapon.attack_crit, this.pc_object, pc_roll_mode);
                let reflect_string = '';

                if (reflect) {
                    reflect_string = this.pc_object.handle_reflect(this.npc_object.reflect_value);
                }

                action_string = `${action_string}${
                    self_string.replace(/\<User\>/g, this.pc_object.name)
                }${
                    target_string.replace(/\<User\>/g, this.pc_object.name).replace(/\<Target\>/g, this.npc_object.name)
                }${
                    reflect_string.replace(/\<User\>/g, this.pc_object.name)
                }`
            }

            const player_attack = [this.player_character.weapon.attack[player_action_index]];
            const self_string = this.pc_object.target_self(player_attack);
            const {target_string, reflect} = this.npc_object.hostile_target(player_attack, this.pc_object, pc_roll_mode);
            let reflect_string = ''

            if (reflect) {
                reflect_string = this.pc_object.handle_reflect(this.npc_object.reflect_value);
            }

            action_string = `${action_string}${
                self_string.replace(/\<User\>/g, this.pc_object.name)
            }${
                target_string.replace(/\<User\>/g, this.pc_object.name).replace(/\<Target\>/g, this.npc_object.name)
            }${
                reflect_string.replace(/\<User\>/g, this.pc_object.name)
            }`
        }

        if (npc_action == 2) {
            if (player_action == 3) {
                const self_string = this.npc_object.target_self(this.non_player_character.weapon.attack_crit);
                const {target_string, reflect } = this.pc_object.hostile_target(this.non_player_character.weapon.attack_crit, this.npc_object, npc_roll_mode);
                let reflect_string = '';

                if (reflect) {
                    reflect_string = this.npc_object.handle_reflect(this.pc_object.reflect_value);
                }

                action_string = `${action_string}${
                    self_string.replace(/\<User\>/g, this.npc_object.name)
                }${
                    target_string.replace(/\<User\>/g, this.npc_object.name).replace(/\<Target\>/g, this.pc_object.name)
                }${
                    reflect_string.replace(/\<User\>/g, this.npc_object.name)
                }`
            }
            const npc_attack = [this.non_player_character.weapon.attack[npc_action_index]];
            const self_string = this.npc_object.target_self(npc_attack);
            const {target_string, reflect} = this.pc_object.hostile_target(npc_attack, this.npc_object, npc_roll_mode);
            let reflect_string = '';

            if (reflect) {
                reflect_string = this.npc_object.handle_reflect(this.pc_object.reflect_value);
            }

            action_string = `${action_string}${
                self_string.replace(/\<User\>/g, this.npc_object.name)
            }${
                target_string.replace(/\<User\>/g, this.npc_object.name).replace(/\<Target\>/g, this.pc_object.name)
            }${
                reflect_string.replace(/\<User\>/g, this.npc_object.name)
            }`
        }

        // Check For Winners
        this.winner = this.check_winners();
        if (this.winner) {
            this.log.push(action_string);
            const winner: string = this.winner
            return { action_string, winner };
        }

        if (player_action == 3) {
            const player_special = [this.player_character.weapon.special[player_action_index]];
            const self_string = this.pc_object.target_self(player_special);
            const {target_string, reflect} = this.npc_object.hostile_target(player_special, this.pc_object, pc_roll_mode);
            let reflect_string = '';

            if (reflect) {
                reflect_string = this.pc_object.handle_reflect(this.npc_object.reflect_value);
            }

            action_string = `${action_string}${
                self_string.replace(/\<User\>/g, this.pc_object.name)
            }${
                target_string.replace(/\<User\>/g, this.pc_object.name).replace(/\<Target\>/g, this.npc_object.name)
            }${
                reflect_string.replace(/\<User\>/g, this.pc_object.name)
            }`
        }

        if (npc_action == 3) {
            const npc_special = [this.non_player_character.weapon.special[npc_action_index]];
            const self_string = this.npc_object.target_self(npc_special);
            const {target_string, reflect }= this.pc_object.hostile_target(npc_special, this.npc_object, npc_roll_mode);
            let reflect_string = '';

            if (reflect) {
                reflect_string = this.npc_object.handle_reflect(this.pc_object.reflect_value);
            }


            action_string = `${action_string}${
                self_string.replace(/\<User\>/g, this.npc_object.name)
            }${
                target_string.replace(/\<User\>/g, this.npc_object.name).replace(/\<Target\>/g, this.pc_object.name)
            }${
                reflect_string.replace(/\<User\>/g, this.npc_object.name)
            }`
        }

        // Check For Winners
        this.winner = this.check_winners();
        if (this.winner) {
            this.log.push(action_string);
            const winner: string = this.winner
            return { action_string, winner };
        }

        // Round End Updating
        this.current_round += 1;
        this.npc_index = (this.npc_index + 1) % this.non_player_character.pattern.length;
        this.npc_stance_index = (this.npc_stance_index + 1) % this.non_player_character.stance_pattern.length;
        const pc_end_string: string = this.pc_object.end_round();
        const npc_end_string: string = this.npc_object.end_round();

        action_string = `${action_string}${pc_end_string.replace(/\<User\>/g, this.pc_object.name)}`
        action_string = `${action_string}${npc_end_string.replace(/\<User\>/g, this.npc_object.name)}`

        this.winner = this.check_winners();

        this.log.push(action_string);
        const winner: string = this.winner
        return { action_string, winner };
    }
}
