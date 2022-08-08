
import Player from './player';

const DEAD: string = "DEAD";
const NONE: string = "NONE";
const DEFEND: string = "DEFEND";
const ATTACK: string = "ATTACK";
const SPECIAL: string = "SPECIAL";

export default class Battle_Player {
    name: string;
    health: number;
    team: number;
    attack: Function;
    defend: Function;
    special: Function;
    battle_status: string;

    constructor (player: Player, team: number) {
        this.name = player.name;
        this.health = player.health;
        this.team = team;
        this.attack = player.attack;
        this.defend = player. defend;
        this.special = player.special;
        this.battle_status = NONE;
    }
}