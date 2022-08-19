/*
    Battle Order
    > Defend (maybe Shield...)
    > Attack
    > Special
*/

import Player from './player';
import Battle_Player from './battle_player';
import logger from "../util/logger";
import { STATE } from './constant'
import Battle_Data from './battle_data';
import { Action, Effect_Group } from './action';
import { Target_Group } from './target_group';

class Battle_Action {
    player: Battle_Player;
    target_effects: Array<Target_Group>;

    constructor(player: Battle_Player, targets: Array<Target_Group>) {
        this.player = player;
        this.target_effects = targets;
    }

    run_action(turn_data: Battle_Data) {
        logger.debug(`Battle Action Targets: ${this.target_effects.flatMap(effect => effect.targets)}`);
        turn_data.add_action(this.player);
        this.target_effects.forEach((tg: Target_Group) => {
            tg.affect_targets(this.player, turn_data);
        });
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
    
    self_target(user: Player) {
        const player = this.players.find((p: Battle_Player) => p.name == user.name);

        if(player) {
            return player
        } else {
            logger.warn(`Battle Player ${user.name} not found when looking for self`);
            return undefined
        }
    }

    all_enemies(user: Player) {
        logger.debug(`Getting all enemies for ${user.name}`);
        const player = this.players.find((p: Battle_Player) => p.name == user.name);

        if(player) {
            return this.players.filter((bplayer: Battle_Player) => bplayer.team != player.team)
        } else {
            logger.warn(`Battle Player ${user.name} not found when looking for enemies`);
            return undefined
        }
    }

    all_allies(user: Player) {
        const player = this.players.find((p: Battle_Player) => p.name == user.name);

        if(player) {
            return this.players.filter((bplayer: Battle_Player) => bplayer.team == player.team)
        } else {
            logger.warn(`Battle Player ${user.name} not found when looking for allies`);
            return undefined
        }
    }

    all_others(user: Player) {
        const player = this.players.find((p: Battle_Player) => p.name == user.name);

        if(player) {
            return this.players.filter((bplayer: Battle_Player) => bplayer.name == player.name)
        } else {
            logger.warn(`Battle Player ${user.name} not found when looking for others`);
            return undefined
        }
    }

    all() {
        return this.players;
    }

    // this is a bit silly, but the mental distinction is important, I think
    possible_targets(user: Player) {
        return this.all_others(user);
    }

    add_action(user: Player, targets: Array<Target_Group>, type: string) {
        const player: Battle_Player | undefined = this.players.find((bplayer: Battle_Player) => bplayer.name == user.name);
        
        logger.debug(`adding for actions ${targets.flatMap(targe => targe.targets.length)}`)

        if(player) {
            const battle_action: Battle_Action = new Battle_Action(player, targets);
            
            switch(type) {
                case STATE.DEFEND:
                    logger.debug(`adding ${player.name} defend action to queue`);
                    this.defend_actions.push(battle_action);
                    player.battle_status = STATE.DEFEND;
                    break;
                case STATE.ATTACK:
                    logger.debug(`adding ${player.name} attack action to queue`);
                    this.attack_actions.push(battle_action);
                    player.battle_status = STATE.ATTACK;
                    break;
                case STATE.SPECIAL:
                    logger.debug(`adding ${player.name} special action to queue`);
                    this.special_actions.push(battle_action);
                    player.battle_status = STATE.SPECIAL;
                    break;
            }
        } else {
            logger.warn(`Player not found when trying to add action: ${user.name}`)
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
            logger.warn(`${no_action.flatMap((p: Battle_Player) => p.name)} havn't input action`);
            return `${no_action.flatMap((p: Battle_Player) => p.name)} havn't input action`;
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