import logger from "../util/logger";
import { Action } from "./action";
import { STATE } from "./constant";


export default class Player {
    name: string;
    health: number;
    attack: Action;
    defend: Action;
    special: Action;

    constructor (name: string, defend: Action, attack: Action, special: Action) {
        // TODO: Action Names
        logger.info(`Creating Player:
Name: ${name}
Health: ${100}`);
        this.name = name;
        this.health = 100;
        this.defend = defend;
        this.attack = attack;
        this.special = special;
    }

    get_action(type: string) {
        switch(type) {
            case STATE.DEFEND:
                return this.defend;
            case STATE.ATTACK:
                return this.attack;
            case STATE.SPECIAL:
                return this.special;
            default:
                logger.warn(`Action ${type} not found for player ${this.name}`);
        }
    }
}