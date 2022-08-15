import logger from "../util/logger";
import Battle_Data from "./battle_data";
import Battle_Player from "./battle_player";
import STATE, { EFFECT, TARGET_REQ } from './constant';

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

    run(turn_data: Battle_Data, self: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) {
        turn_data.add_action(self);
        this.action_list.forEach((effect: Effect) => {
            logger.debug(`executing effect ${effect.type} and target req ${effect.target_req}`);
            let amount: number;
            // effect.execute(turn_data, self, attack_targets, heal_targets)
            switch (effect.target_req) {
                case TARGET_REQ.SELF:
                    logger.debug('Running Self Effect');
                    amount = effect.execute([self]);
                    turn_data.add_target(self, self, amount, effect.type)
                    break;
                case TARGET_REQ.SINGLE:
                    logger.debug('Running single Effect');
                    if (effect.type == EFFECT.HEAL) {
                        amount = effect.execute(heal_targets.slice(0, 1));
                        turn_data.add_target(self, heal_targets[0], amount, effect.type);
                        break;
                    } else {
                        amount = effect.execute(damage_targets.slice(0, 1));
                        turn_data.add_target(self, damage_targets[0], amount, effect.type);
                    }
                    break;
                case TARGET_REQ.ALL:
                    logger.debug('Running All Effect');
                    if (effect.type == EFFECT.HEAL) {
                        amount = effect.execute(heal_targets);
                        heal_targets.forEach(target => turn_data.add_target(self, target, amount, effect.type));
                        break;
                    } else {
                        amount = effect.execute(damage_targets);
                        damage_targets.forEach(target => turn_data.add_target(self, target, amount, effect.type));
                    }
                    break;
                default:
                    logger.warn(`Uknown target_type: ${effect.target_req}`);
            }
        });
    }
}

export class Effect {
    roll: number;
    // this might should change
    critical: number;
    type: string;
    target_req: string;

    constructor(roll: number, critical: number, type: string, target_req: string) {
        this.roll = roll;
        this.critical = critical;
        this.type = type;
        this.target_req = target_req;
    }

    execute(targets: Array<Battle_Player>) { return 0 }

    // execute(turn_data: Battle_Data, self: Battle_Player, attack_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player> ){
        // TODO: check for damage resist
        // start with all targets getting the same amount of damage, maybe change that
        // Constant damage
        // const amount = Math.ceil(Math.random() * this.roll);
        // logger.debug(`Running Effect\nself: ${self.name} \nRoll: ${amount}\nEffect Type: ${this.type}`);

        // switch(this.type) {
        //     case EFFECT.DAMAGE:
        //         attack_targets.forEach((target: Battle_Player) => {
        //             logger.debug(`Damaging ${target.name}`)
        //             target.health -= amount;
        //             turn_data.add_target(self, target, amount, this.type)
        //         });
        //         break;
        //     case EFFECT.HEAL:
        //         heal_targets.forEach((target: Battle_Player) => {
        //             logger.debug(`Healing ${target.name}`)
        //             target.health += amount;
        //             turn_data.add_target(self, target, amount, this.type)
        //         });
        //         break;
        //     default:
        //         logger.debug(`Type not recognized: ${this.type}`);
        // }
    // }
}

export class Damage_Effect extends Effect {

    constructor(roll: number, critical: number, target_req: string) {
        super(roll, critical, EFFECT.DAMAGE, target_req);
    }

    execute(targets: Array<Battle_Player>) {
        const damage = Math.ceil(Math.random() * this.roll);
        
        targets.forEach((target: Battle_Player) => {
            // crits
            target.health = target.health - damage;
        });

        return damage
    }
}

export class Heal_Effect extends Effect {

    constructor(roll: number, critical: number, target_req: string) {
        super(roll, critical, EFFECT.HEAL, target_req);
    }

    execute(targets: Array<Battle_Player>) {
        const damage = Math.ceil(Math.random() * this.roll);
        
        targets.forEach((target: Battle_Player) => {
            // crits
            target.health = target.health + damage;
        });

        return damage
    }
}