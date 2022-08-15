/*
    Battle Order
    > Defend (maybe Shield...)
    > Attack
    > Special
*/

import Player from './player';
import Battle_Player from './battle_player';
import logger from "../util/logger";
import STATE from './constant'
import Battle_Data from './battle_data';
import { Action } from './action';

class Battle_Action {
    action: Action;
    player: Battle_Player;
    damage_targets: Array<Battle_Player>;
    heal_targets: Array<Battle_Player>;

    constructor(action: Action, player: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) {
        this.action = action;
        this.player = player;
        this.damage_targets = damage_targets;
        this.heal_targets = heal_targets;
    }

    run_action(turn_data: Battle_Data) {
        logger.debug(`Running saved action:\nSelf: ${this.player.name}\nAction Type: ${this.action.type}\n
        D Targets:${this.damage_targets.flatMap((p: Battle_Player) => p.name).join(', ')}
        H Targets:${this.heal_targets.flatMap((p: Battle_Player) => p.name).join(', ')}`);
        this.action.run(turn_data, this.player, this.damage_targets, this.heal_targets);
    }
}

export default class Battle {
    id: number;
    players: Array<Battle_Player>;
    number_of_teams: number;
    state: string;
    round_count: number;
    defend_actions: Array<Battle_Action>;
    attack_actions: Array<Battle_Action>;
    special_actions: Array<Battle_Action>;
    
    
    constructor (id: number) {
        this.id = id;
        this.players = [];
        this.number_of_teams = 0;
        this.state = "input";
        this.round_count = 1;
        this.defend_actions = [];
        this.attack_actions = [];
        this.special_actions = [];
    }

    inialize_battle(...teams: Array<Array<Player>>) {
        let team_index = 0;
        teams.forEach(
            (team: Array<Player>) => {
                team.forEach((player: Player) => {
                    this.players.push(new Battle_Player(player, team_index))
                });
                team_index++;
            });
            this.number_of_teams = team_index;
            // TODO: team colors rather than numbers
            logger.info("Starting Battle");
            return 'Starting Battle'
        }
        
        add_defend(player: Player, damage_targets: Array<Player>, heal_targets: Array<Player>) {
            let defend_player = this.players.find((b_player: Battle_Player) => b_player.name == player.name);
            
            logger.debug(`Adding ${player.name} to defense`);
            logger.debug(`Damage Targets: ${damage_targets.flatMap((p: Player) => p.name).join(",")}`);
            logger.debug(`Heal Targets: ${heal_targets.flatMap((p: Player) => p.name).join(",")}`);
            
            if (defend_player) {
                let damage_array: Array<Battle_Player> = [];
                
                let heal_array: Array<Battle_Player> = [];
                
                damage_targets.forEach((player: Player) => {
                    let damage_target = this.players.find((target: Battle_Player) => target.name == player.name);
                    if (damage_target) {
                        damage_array.push(damage_target);
                    } else {
                        // log event
                        logger.warn("Target not found in battle.  Defend.")
                    }
                });
                
                heal_targets.forEach((player: Player) => {
                    let heal_target = this.players.find((target: Battle_Player) => target.name == player.name);
                    if (heal_target) {
                        heal_array.push(heal_target);
                    } else {
                        // log event
                        logger.warn("Target not found in battle.  Defend.")
                    }
                });
                
                this.defend_actions.push(new Battle_Action(defend_player.defend, defend_player, damage_array, heal_array));
                
                defend_player.battle_status = STATE.DEFEND;
            } else {
            // Log event
            logger.warn("Player not found.  Defend.")
        }        
    }
    
    add_attack(player: Player, damage_targets: Array<Player>, heal_targets: Array<Player>) {
        let attack_player = this.players.find((b_player: Battle_Player) => b_player.name == player.name);

        logger.debug(`Adding ${player.name} to attack`);
        logger.debug(`Damage Targets: ${damage_targets.flatMap((p: Player) => p.name).join(",")}`);
        logger.debug(`Heal Targets: ${heal_targets.flatMap((p: Player) => p.name).join(",")}`);
        
        if (attack_player) {
            let damage_array: Array<Battle_Player> = [];
            
            let heal_array: Array<Battle_Player> = [];
            
            damage_targets.forEach((player: Player) => {
                let damage_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (damage_target) {
                    damage_array.push(damage_target);
                } else {
                    // log event
                    logger.info("Target not found in battle.  Attack.")
                }
            });
            
            heal_targets.forEach((player: Player) => {
                let heal_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (heal_target) {
                    heal_array.push(heal_target);
                } else {
                    // log event
                    logger.info("Target not found in battle.  Attack.")
                }
            });
            
            this.attack_actions.push(new Battle_Action(attack_player.attack, attack_player, damage_array, heal_array));
            
            attack_player.battle_status = STATE.ATTACK;
        } else {
            // Log event
            logger.warn("Player not found.  Attack.")
        }        
        
    }
    
    add_special(player: Player, damage_targets: Array<Player>, heal_targets: Array<Player>) {
        let special_player = this.players.find((b_player: Battle_Player) => b_player.name == player.name);
        
        logger.debug(`Adding ${player.name} to special`);
        logger.debug(`Damage Targets: ${damage_targets.flatMap((p: Player) => p.name).join(",")}`);
        logger.debug(`Heal Targets: ${heal_targets.flatMap((p: Player) => p.name).join(",")}`);
        
        if (special_player) {
            let damage_array: Array<Battle_Player> = [];
            
            let heal_array: Array<Battle_Player> = [];
            
            damage_targets.forEach((player: Player) => {
                let damage_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (damage_target) {
                    damage_array.push(damage_target);
                } else {
                    // log event
                    logger.info("Target not found in battle.  Special.")
                }
            });
            
            heal_targets.forEach((player: Player) => {
                let heal_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (heal_target) {
                    heal_array.push(heal_target);
                } else {
                    // log event
                    logger.info("Target not found in battle.  Special.")
                }
            });

            this.special_actions.push(new Battle_Action(special_player.special, special_player, damage_array, heal_array));
            
            special_player.battle_status = STATE.SPECIAL;
        } else {
            // Log event
            logger.warn("Player not found.  Special.")
        }      
    }
    
    health_check() {
        let return_message = '\n**Health Left**:\n';
        
        this.players.forEach((player: Battle_Player) => {
            if (player.health <= 0) {
                return_message += `${player.name}: 0\n`;
            } else {
                return_message += `${player.name}: ${player.health}\n`;
            }
        });

        return return_message
    }

    death_check(turn_data: Battle_Data) {
        logger.debug('Checking deaths');
        this.players.forEach((player: Battle_Player) => {
            if(player.health <= 0) {
                // info?
                logger.debug(`${player.name} has died`);
                player.battle_status = STATE.DEAD;
                turn_data.add_death(player);
            }
        });

        logger.debug('Checking Wins')
        const possible_winners = this.players
            .filter((player: Battle_Player) => player.battle_status != STATE.DEAD);

        if(possible_winners
            .every((player: Battle_Player, index: number, array: Array<Battle_Player>) => player.team == array[0].team)) {
                // declare winner
                logger.debug(`${possible_winners.flatMap((winner: Battle_Player) => winner.name).join(" and ")} have won.`);
                turn_data.set_winners(possible_winners);
                logger.info("Battle Over gg.")
        }
    }
    // check who hasn't input action yet function?
    
    resolve() {

        const no_action: Array<Battle_Player> = this.players.filter((player: Battle_Player) => player.battle_status == STATE.NONE );
        
        logger.info(!no_action.length)

        // check if all players input actions
        if (!!no_action.length) {
            // log event
            logger.warn(`${no_action} havn't input action`);
            return `${no_action} havn't input action`;
        }
        
        const turn_data: Battle_Data = new Battle_Data(this.round_count);
        logger.debug('Turn Data Created');

        // resolve defend
        this.defend_actions.forEach((action: Battle_Action) => {
            // needs strings
            logger.debug(`Running ${action.player.name}'s defend action`);
            action.run_action(turn_data);
        });
        
        this.death_check(turn_data);
        if(turn_data.win_check()) {
            logger.debug('Win Confirmed');
            return turn_data.to_string().concat(this.health_check());
        }
        
        // resolve attack
        this.attack_actions.forEach((action: Battle_Action) => {
            logger.debug(`Running ${action.player.name}'s attack action`);
            action.run_action(turn_data);
        });
        
        this.death_check(turn_data);
        if(turn_data.win_check()) {
            logger.debug('Win Confirmed');
            return turn_data.to_string().concat(this.health_check());
        }
        
        // resolve special
        this.special_actions.forEach((action: Battle_Action) => {
            logger.debug(`Running ${action.player.name}'s special action`);
            action.run_action(turn_data);
        });
        
        this.death_check(turn_data);
        if(turn_data.win_check()) {
            logger.debug('Win Confirmed');
            return turn_data.to_string().concat(this.health_check());
        }
        
        // Passives/Statuses

        // Cleanup
        this.players.forEach((player: Battle_Player) => {
            if (player.battle_status != STATE.DEAD) {
                player.battle_status = STATE.NONE
            }
        });

        this.defend_actions = [];
        this.attack_actions = [];
        this.special_actions = [];

        this.round_count++;
        logger.info(`Next Round Start: ${this.round_count}`);
        
        return turn_data.to_string().concat(this.health_check());
    }

}