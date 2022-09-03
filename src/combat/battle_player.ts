
import { Action } from './action';
import Player from './player';
import { STATE } from './constant';
import { Status } from './status';

export class Battle_Status {
    duration: number;
    intensity: number;
    status: Status

    constructor(status: Status, intensity: number) {
        this.status = status;
        this.duration = status.duration;
        this.intensity = intensity;
    }

    end_of_turn_effect(player: Battle_Player) {
        this.duration -= 1;
        this.status.end_of_turn_effect(player, this.intensity)
    }

    action_effect(amount: number) {
        this.duration -= 1
        return this.status.action_effect(amount, this.intensity)
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
        this.statuses.push(status)
    }

    check_statuses() {
        this.statuses = this.statuses.filter((stats: Battle_Status) => stats.duration > 0);
    }
}