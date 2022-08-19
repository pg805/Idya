
import { Action } from './action';
import Player from './player';
import { STATE } from './constant';

export default class Battle_Player {
    name: string;
    health: number;
    max_health: number;
    team: number;
    attack: Action;
    defend: Action;
    special: Action;
    battle_status: string;

    constructor (player: Player, team: number) {
        this.name = player.name;
        this.health = player.health;
        this.max_health = player.health;
        this.team = team;
        this.attack = player.attack;
        this.defend = player. defend;
        this.special = player.special;
        this.battle_status = STATE.NONE;
    }
}