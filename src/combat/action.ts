import logger from "../util/logger";
import Battle_Data from "./battle_data";
import Battle_Player from "./battle_player";
import STATE, { EFFECT } from './constant';

export class Effect {
    roll: number;
    // this might should change
    critical_effect: number;
    type: string;

    constructor(roll: number, critical_effect: number, type: string) {
        this.roll = roll;
        this.critical_effect = critical_effect;
        this.type = type;
    }

    execute(turn_data: Battle_Data, self: Battle_Player, attack_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player> ){
        // TODO: check for damage resist
        // start with all targets getting the same amount of damage, maybe change that
        // Constant damage
        const amount = Math.ceil(Math.random() * this.roll);
        logger.debug(`Running Effect\nself: ${self.name} \nRoll: ${amount}\nEffect Type: ${this.type}`);

        switch(this.type) {
            case EFFECT.DAMAGE:
                attack_targets.forEach((target: Battle_Player) => {
                    logger.debug(`Damaging ${target.name}`)
                    target.health -= amount;
                    turn_data.add_target(self, target, amount, this.type)
                });
                break;
            case EFFECT.HEAL:
                heal_targets.forEach((target: Battle_Player) => {
                    logger.debug(`Healing ${target.name}`)
                    target.health += amount;
                    turn_data.add_target(self, target, amount, this.type)
                });
                break;
            default:
                logger.debug(`Type not recognized: ${this.type}`);
        }
    }
}

export class Action {
    action_list: Array<Effect>;
    type: string;
    
    constructor(type: string) {
        this.action_list = [];
        this.type = type;
    }

    add_effect(effect: Effect) {
        logger.debug(`Adding Effect of type ${effect.type}`);
        this.action_list.push(effect)
    }

    run(turn_data: Battle_Data, self: Battle_Player, attack_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) {
        turn_data.add_action(self);
        this.action_list.forEach((effect: Effect) => {
            logger.debug(`executing effect ${effect.type}`);
            effect.execute(turn_data, self, attack_targets, heal_targets)
        });
    }
}