

export default class Player {
    name: string;
    health: number;
    attack: Function;
    defend: Function;
    special: Function;

    constructor (name: string, defend: Function, attack: Function, special: Function) {
        this.name = name;
        this.health = 100;
        this.defend = defend;
        this.attack = attack;
        this.special = special;
    }
}