/*
    Battle Order
    > Shield
    > Attack
    > Special
*/

import { Message } from 'discord.js';
import Player from './player';
import Battle_Player from './battle_player';

const DEAD: string = "DEAD";
const NONE: string = "NONE";
const DEFEND: string = "DEFEND";
const ATTACK: string = "ATTACK";
const SPECIAL: string = "SPECIAL";

class Battle_Action {
    action: Function;
    player: Battle_Player;
    damage_targets: Array<Battle_Player>;
    heal_targets: Array<Battle_Player>;

    constructor(action: Function, player: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) {
        this.action = action;
        this.player = player;
        this.damage_targets = damage_targets;
        this.heal_targets = heal_targets;
    }

    run_action() {
        this.action(this.player, this.damage_targets, this.heal_targets);
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
        this.round_count = 0;
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
    }

    add_defend(player: Player, damage_targets: Array<Player>, heal_targets: Array<Player>) {
        let defend_player = this.players.find((b_player: Battle_Player) => b_player.name == player.name);

        if (defend_player) {
            let damage_array: Array<Battle_Player> = [];

            let heal_array: Array<Battle_Player> = [];

            damage_targets.forEach((player: Player) => {
                let damage_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (damage_target) {
                    damage_array.push(damage_target);
                } else {
                    // log event
                }
            });

            heal_targets.forEach((player: Player) => {
                let heal_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (heal_target) {
                    heal_array.push(heal_target);
                } else {
                    // log event
                }
            });

            this.defend_actions.push(new Battle_Action(defend_player.defend, defend_player, damage_array, heal_array));

            defend_player.battle_status = DEFEND;
        } else {
            // Log event
        }        
    }
    
    add_attack(player: Player, damage_targets: Array<Player>, heal_targets: Array<Player>) {
        let attack_player = this.players.find((b_player: Battle_Player) => b_player.name == player.name);

        if (attack_player) {
            let damage_array: Array<Battle_Player> = [];

            let heal_array: Array<Battle_Player> = [];

            damage_targets.forEach((player: Player) => {
                let damage_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (damage_target) {
                    damage_array.push(damage_target);
                } else {
                    // log event
                }
            });

            heal_targets.forEach((player: Player) => {
                let heal_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (heal_target) {
                    heal_array.push(heal_target);
                } else {
                    // log event
                }
            });

            this.attack_actions.push(new Battle_Action(attack_player.attack, attack_player, damage_array, heal_array));

            attack_player.battle_status = ATTACK;
        } else {
            // Log event
        }        
        
    }
    
    add_special(player: Player, damage_targets: Array<Player>, heal_targets: Array<Player>) {
        let special_player = this.players.find((b_player: Battle_Player) => b_player.name == player.name);

        if (special_player) {
            let damage_array: Array<Battle_Player> = [];

            let heal_array: Array<Battle_Player> = [];

            damage_targets.forEach((player: Player) => {
                let damage_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (damage_target) {
                    damage_array.push(damage_target);
                } else {
                    // log event
                }
            });

            heal_targets.forEach((player: Player) => {
                let heal_target = this.players.find((target: Battle_Player) => target.name == player.name);
                if (heal_target) {
                    heal_array.push(heal_target);
                } else {
                    // log event
                }
            });

            this.special_actions.push(new Battle_Action(special_player.special, special_player, damage_array, heal_array));

            special_player.battle_status = SPECIAL;
        } else {
            // Log event
        }      
    }

    // check who hasn't input action yet function?

    resolve() {
        // check if all players input actions
        if (this.players.find(
                (player: Battle_Player) => player.battle_status == NONE )
        ) {
            // log event
            return;
        }

        // resolve defend
        this.defend_actions.forEach((action: Battle_Action) => {
            action.run_action();
        });
        
        this.players.forEach((player: Battle_Player) => {
            if(player.health <= 0) {
                player.battle_status = DEAD
            }
        });
        
        if(this.players
            .filter((player: Battle_Player) => player.battle_status != DEAD)
            .every((player: Battle_Player, index: number, array: Array<Battle_Player>) => player.team == array[0].team)) {
                // declare winner
                return;
        }
        
        // resolve attack
        this.attack_actions.forEach((action: Battle_Action) => {
            action.run_action();
        });
        
        this.players.forEach((player: Battle_Player) => {
            if(player.health <= 0) {
                player.battle_status = DEAD
            }
        });
        
        if(this.players
            .filter((player: Battle_Player) => player.battle_status != DEAD)
            .every((player: Battle_Player, index: number, array: Array<Battle_Player>) => player.team == array[0].team)) {
                // declare winner
                return;
        }
        
        // resolve special
        this.special_actions.forEach((action: Battle_Action) => {
            action.run_action();
        });
        
        this.players.forEach((player: Battle_Player) => {
            if(player.health <= 0) {
                player.battle_status = DEAD
            }
        });
        
        if(this.players
            .filter((player: Battle_Player) => player.battle_status != DEAD)
            .every((player: Battle_Player, index: number, array: Array<Battle_Player>) => player.team == array[0].team)) {
                // declare winner
                return;
        }
        
        // Cleanup
        this.players.forEach((player: Battle_Player) => {
            if (player.battle_status != DEAD) {
                player.battle_status = NONE
            }
        });

        this.defend_actions = [];
        this.attack_actions = [];
        this.special_actions = [];
    }

}