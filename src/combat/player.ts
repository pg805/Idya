import { Action } from "./action";


export default class Player {
    name: string;
    health: number;
    attack: Action;
    defend: Action;
    special: Action;

    constructor (name: string, defend: Action, attack: Action, special: Action) {
        this.name = name;
        this.health = 100;
        this.defend = defend;
        this.attack = attack;
        this.special = special;
    }
}