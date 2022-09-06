
import { Action } from './action';
import Player from './player';
import { STATE } from './constant';
import { Status } from './status';
import Battle_Data from './battle_data';
import logger from '../util/logger';

export class Battle_Status {
    duration: number;
    intensity: number;
    status: Status;

    constructor(status: Status, intensity: number) {
        this.status = status;
        this.duration = status.duration;
        this.intensity = intensity;
    }

    end_of_turn_effect(player: Battle_Player, turn_data: Battle_Data) {
        logger.debug(`Battle Status - Running end of turn effect ${this.status.name} on ${player.name} with intensity ${this.intensity}.  ${this.duration - 1} turns left of status.`)
        this.duration -= 1;
        this.status.end_of_turn_effect(player, this.intensity, turn_data)
    }
    
    action_effect(amount: number, turn_data: Battle_Data) {
        logger.debug(`Battle Status - Running action effect ${this.status.name} with intensity ${this.intensity} on amount ${amount}.  ${this.duration - 1} turns left of status.`)
        this.duration -= 1
        return this.status.action_effect(amount, this.intensity, turn_data)
    }
}

export default class Battle_Player {
    name: string;
    health: number;
    max_health: number;
    team: number;
    attack: Action;
    defend: Action;
    special: Action;
    battle_status: string;
    statuses: Array<Battle_Status>

    constructor (player: Player, team: number) {
        this.name = player.name;
        this.health = player.health;
        this.max_health = player.health;
        this.team = team;
        this.attack = player.attack;
        this.defend = player. defend;
        this.special = player.special;
        this.battle_status = STATE.NONE;
        this.statuses = [];
    }

    add_status(status: Battle_Status) {
        logger.debug(`Battle Player - Adding status ${status.status.name} to player ${this.name} with intensity ${status.intensity} and duration ${status.duration}`)
        this.statuses.push(status)
    }

    check_statuses() {
        logger.debug(`Battle Player - Checking statuses for player ${this.name}.  ${this.statuses.filter((stats: Battle_Status) => stats.duration > 0).length} statuses left`)
        this.statuses = this.statuses.filter((stats: Battle_Status) => stats.duration > 0);
    }
}