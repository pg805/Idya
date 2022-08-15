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
                    amount = effect.execute(self.battle_status, self);
                    turn_data.add_target(self, self, amount, effect.type, check_crit(self.battle_status, self.battle_status))
                    break;
                case TARGET_REQ.SINGLE:
                    logger.debug('Running single Effect');
                    if (effect.type == EFFECT.HEAL) {
                        amount = effect.execute(self.battle_status, heal_targets[0]);
                        turn_data.add_target(self, heal_targets[0], amount, effect.type, check_crit(self.battle_status, heal_targets[0].battle_status));
                        break;
                    } else {
                        amount = effect.execute(self.battle_status, damage_targets[0]);
                        turn_data.add_target(self, damage_targets[0], amount, effect.type, check_crit(self.battle_status, damage_targets[0].battle_status));
                    }
                    break;
                case TARGET_REQ.ALL:
                    logger.debug('Running All Effect');
                    if (effect.type == EFFECT.HEAL) {
                        heal_targets.forEach(target => {
                            amount = effect.execute(self.battle_status, target);
                            turn_data.add_target(self, target, amount, effect.type, check_crit(self.battle_status, target.battle_status))
                        });
                        break;
                    } else {
                        damage_targets.forEach(target => {
                            amount = effect.execute(self.battle_status, target);
                            turn_data.add_target(self, target, amount, effect.type, check_crit(self.battle_status, target.battle_status));
                        });
                    }
                    break;
                default:
                    logger.warn(`Uknown target_type: ${effect.target_req}`);
            }
        });
    }
}

// Effect needs to know user's attack type to determine crit
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

    execute(user_action: string, target: Battle_Player) { return 0 }
}

export function check_crit(user_action: string, target_action: string) {
    if ((target_action == STATE.DEFEND && user_action == STATE.SPECIAL) ||
    (target_action == STATE.ATTACK && user_action == STATE.DEFEND) ||
    (target_action == STATE.SPECIAL && user_action == STATE.ATTACK)
    ) {
        return true
    }
    return false
}

export class Damage_Effect extends Effect {

    constructor(roll: number, critical: number, target_req: string) {
        super(roll, critical, EFFECT.DAMAGE, target_req);
    }

    execute(user_action: string, target: Battle_Player) {
        
        const crit = check_crit(user_action, target.battle_status) ? this.critical : 1;

        const damage = Math.floor(Math.ceil(Math.random() * this.roll) * crit);

        target.health = target.health - damage;

        return damage
    }
}

export class Heal_Effect extends Effect {

    constructor(roll: number, critical: number, target_req: string) {
        super(roll, critical, EFFECT.HEAL, target_req);
    }

    execute(user_action: string, target: Battle_Player) {
        const crit = check_crit(user_action, target.battle_status) ? this.critical : 1;
        
        const health = Math.floor(Math.ceil(Math.random() * this.roll) * crit);
        
        target.health = target.health + health;

        return health
    }
}