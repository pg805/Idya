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

class Player_Object {
    name: string
    health: number
    max_health: number // TODO, add to constructor
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

    constructor(name: string, health: number) {
        this.name = name;
        this.health = health;
        this.max_health = health;
    }

    target_self(action_array: Array<Action>) {
        let action_string = '';

        action_array.forEach((action: Action) => {
            // Block
            if (action.type == 2) {
                const block = (<Block>action).value;
                this.block = block;

                action_string = `${action_string}\n${action.action_string}`;
                
                logger.info(
                    `Resolving ${this.name} Block: ${action.name}
Value: ${block}`
                );
            }

            // Buff
            if (action.type == 3) {
                const buff_value = (<Buff>action).value;
                this.buff_value = buff_value;

                const buff_rounds = (<Buff>action).rounds;
                this.buff_rounds = buff_rounds;

                const old_debuff = this.debuff_value;
                const old_debuff_rounds = this.debuff_rounds;
                this.debuff_value = 0;
                this.debuff_rounds = 0;

                action_string = `${action_string}\n${action.action_string}`;

                logger.info(
                    `Resolving ${this.name} Buff: ${action.name}
Buff Value: ${buff_value}
Debuff Rounds: ${buff_rounds}
Old Debuff Value: ${old_debuff}
Old Debuff Rounds: ${old_debuff_rounds}`
                );
            }

            // Heal
            if (action.type == 6) {
                const heal = (<Heal>action).value;
                this.health = Math.min(this.health + heal, this.max_health);

                action_string = `${action_string}\n${action.action_string}`;

                logger.info(
                    `Resolving ${this.name} Heal: ${action.name}
Value: ${heal}
Health: ${this.health}`
                );
            }

            // Reflect
            if (action.type == 7) {
                const reflect_value = (<Reflect>action).value;
                this.reflect_value = reflect_value;

                const reflect_rounds = (<Reflect>action).rounds;
                this.reflect_rounds = reflect_rounds;

                action_string = `${action_string}\n${action.action_string}`;

                logger.info(
                    `Resolving ${this.name} Reflect: ${action.name}
Value: ${reflect_value}
Rounds: ${reflect_rounds}`
                );
            }

            // Shield
            if (action.type == 8) {
                const shield_value = (<Shield>action).value;
                this.shield_value = shield_value;

                const shield_rounds = (<Shield>action).rounds;
                this.shield_rounds = shield_rounds;

                action_string = `${action_string}\n${action.action_string}`;

                logger.info(
                    `Resolving ${this.name} Shield: ${action.name}
Value: ${shield_value}
Rounds: ${shield_rounds}`
                );
            }
        });

        return action_string
    }

    hostile_target(action_array: Array<Action>, hostile_object: Player_Object) {
        let target_string = '';

        let reflect = false;

        action_array.forEach((action: Action) => {
            // Strike
            if (action.type == 1) {
                reflect = true;
                const damage_roll: number = (<Strike>action).field.get_result();
                const damage: number = Math.max(damage_roll - this.block - this.shield_value + hostile_object.buff_value - hostile_object.debuff_value, 0);
                this.health = Math.max(this.health - damage, 0);

                const rolled_string = `  ${hostile_object.name} rolled ${damage_roll}.`

                const block_string: string = this.block + this.shield_value > 0 ? `  ${this.name} blocked ${this.block+this.shield_value} damage.` : ''

                const buff_string: string = hostile_object.buff_value ? `  <Target> buffed their attack by ${hostile_object.buff_value}.` : ''
                const debuff_string: string = hostile_object.debuff_value ? `  <Target>'s attack was debuffed by ${hostile_object.debuff_value}.` : ''

                target_string = `${target_string}\n${action.action_string.replace('<Damage>', `${damage}`)}${rolled_string}${block_string}${buff_string}${debuff_string}`;

                logger.info(
                    `Resolving Strike on ${this.name}: ${action.name}
Damage Roll: ${damage_roll}
Block: ${this.block}
Shield: ${this.shield_value}
Buff: ${hostile_object.buff_value}
Debuff: ${hostile_object.debuff_value}
Damage Value: ${damage}
Health: ${this.health}`
                );
            }

            // DOT
            if (action.type == 4) {
                const damage: number = (<Damage_Over_Time>action).field.get_result();
                this.damage_over_time_value = damage;

                const rounds: number = (<Damage_Over_Time>action).rounds;
                this.damage_over_time_rounds = rounds;

                target_string = `${target_string}\n${action.action_string.replace('<Damage>', `${damage}`)}`;

                logger.info(
                    `Resolving DOT on ${this.name}: ${action.name}
Value: ${damage}
Rounds: ${rounds}`
                );
            }

            // Debuff
            if (action.type == 5) {
                const debuff = (<Debuff>action).value;
                this.debuff_value = debuff;

                const rounds = (<Debuff>action).rounds;
                this.debuff_rounds = rounds;

                const old_buff = this.buff_value;
                const old_buff_rounds = this.buff_rounds;
                this.buff_value = 0;
                this.buff_rounds = 0;

                target_string = `${target_string}\n${action.action_string}`;

                logger.info(
                    `Resolving Debuff on ${this.name}: ${action.name}
Value: ${debuff}
Rounds: ${rounds}
Old Buff Value: ${old_buff}
Old Buff Rounds: ${old_buff_rounds}`
                );
            }
        });

        return {target_string, reflect};
    }

    handle_reflect(damage: number) {
        this.health = Math.max(this.health - damage, 0);

        const action_string = damage > 0 ? `\n${damage} damage was reflected to <User>.` : '';

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
            this.health = Math.max(this.health - this.damage_over_time_value, 0);
            this.damage_over_time_rounds -= 1;

            action_string = `${action_string}\n${this.name} takes ${this.damage_over_time_value} damage.  This DOT has ${this.damage_over_time_rounds} round(s) left`;

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
    current_round = 1;
    complete = false;
    winner = '';
    log: Array<string> = []


    constructor(player_character: Player_Character, non_player_character: Non_Player_Character) {
        this.player_character = player_character;
        this.non_player_character = non_player_character;
        this.pc_object = new Player_Object(player_character.name, player_character.health);
        this.npc_object = new Player_Object(non_player_character.name, non_player_character.health);
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

    resolve_round(player_action: number) {
        let action_string: string = `Round ${this.current_round}`
        const npc_action: number = this.non_player_character.pattern.field[this.npc_index];
        logger.info(
            `***************************
Resolving Turn
Current Round: ${this.current_round}
Player Health: ${this.pc_object.health}
Non Player Health: ${this.npc_object.health}
Player Action: ${player_action}
Non Player Character Action: ${npc_action}
`
        );


        if (player_action == 1) {
            const self_string = this.pc_object.target_self(this.player_character.weapon.defend);
            const { target_string, reflect } = this.npc_object.hostile_target(this.player_character.weapon.defend, this.pc_object);
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
            const self_string = this.npc_object.target_self(this.non_player_character.weapon.defend);
            const { target_string, reflect } = this.pc_object.hostile_target(this.non_player_character.weapon.defend, this.npc_object);
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
                const {target_string, reflect} = this.npc_object.hostile_target(this.player_character.weapon.attack_crit, this.pc_object);
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

            const self_string = this.pc_object.target_self(this.player_character.weapon.attack);
            const {target_string, reflect} = this.npc_object.hostile_target(this.player_character.weapon.attack, this.pc_object);
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
                const {target_string, reflect } = this.pc_object.hostile_target(this.non_player_character.weapon.attack_crit, this.npc_object);
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
            const self_string = this.npc_object.target_self(this.non_player_character.weapon.attack);
            const {target_string, reflect} = this.pc_object.hostile_target(this.non_player_character.weapon.attack, this.npc_object);
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
            const self_string = this.pc_object.target_self(this.player_character.weapon.special);
            const {target_string, reflect} = this.npc_object.hostile_target(this.player_character.weapon.special, this.pc_object);
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
            const self_string = this.npc_object.target_self(this.non_player_character.weapon.special);
            const {target_string, reflect }= this.pc_object.hostile_target(this.non_player_character.weapon.special, this.npc_object);
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
