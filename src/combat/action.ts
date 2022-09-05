
import logger from "../util/logger";
import Battle_Data from "./battle_data";
import Battle_Player, { Battle_Status } from "./battle_player";
import { STATE, EFFECT, TARGET_REQ } from './constant';
import { Status } from './status';

export class Action {
    action_list: Array<Effect_Group>;
    type: string;
    
    constructor(type: string) {
        this.action_list = [];
        this.type = type;
    }

    get_reqs() {
        return this.action_list.flatMap((effects: Effect_Group) => effects.target_req);
    }

    add_effect(effect: Effect_Group) {
        logger.debug(`Adding effect group with requirement ${effect.target_req}`);   
        this.action_list.push(effect);
    }
}

export class Effect_Group {
    effects: Array<Effect>;
    target_req: string;
    // name: string???? for prompting?

    constructor(target_req: string) {
        this.effects = [];
        this.target_req = target_req;
    }

    add_effect(effect: Effect) {
        this.effects.push(effect);
    }
}

// Effect needs to know user's attack type to determine crit
export class Effect {
    roll: number;
    // this might should change
    constant: number;
    critical: number;
    type: string;

    constructor(roll: number, constant: number, critical: number, type: string) {
        this.roll = roll;
        this.constant = constant;
        this.critical = critical;
        this.type = type;
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data) { return 0 }
}

export function check_crit(user_action: string, target_action: string) {
    if ((target_action == STATE.DEFEND && user_action == STATE.SPECIAL) ||
    (target_action == STATE.ATTACK && user_action == STATE.DEFEND) ||
    (target_action == STATE.SPECIAL && user_action == STATE.ATTACK)
    ) {
        return true;
    }
    return false;
}

export class Damage_Effect extends Effect {

    constructor(roll: number, constant: number, critical: number) {
        super(roll, constant, critical, EFFECT.DAMAGE);
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data) {
        
        const crit = check_crit(user.battle_status, target.battle_status) ? this.critical : 1;

        let damage = Math.floor((Math.ceil(Math.random() * this.roll) + this.constant) * crit);

        user.statuses.forEach((stats: Battle_Status) => {
            damage += stats.action_effect(damage, turn_data)
        });

        target.health = target.health - damage;

        turn_data.add_target(user, target, damage, EFFECT.DAMAGE, check_crit(user.battle_status, target.battle_status));

        return damage
    }
}

export class Heal_Effect extends Effect {

    constructor(roll: number, constant: number, critical: number) {
        super(roll, constant, critical, EFFECT.DAMAGE);
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data) {
        const crit = check_crit(user.battle_status, target.battle_status) ? this.critical : 1;
        
        let health = Math.floor((Math.ceil(Math.random() * this.roll) + this.constant) * crit);    
        
        user.statuses.forEach((stats: Battle_Status) => {
            health += stats.action_effect(health, turn_data)
        });

        target.health = target.health + health;

        turn_data.add_target(user, target, health, EFFECT.HEAL, check_crit(user.battle_status, target.battle_status));

        return health
    }
}

export class Status_Effect extends Effect {
    status: Status

    constructor(status: Status, critical: number) {
        super(0, 0, critical, EFFECT.STATUS)
        this.status = status;
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data): number {
        const crit = check_crit(user.battle_status, target.battle_status) ? this.critical : 1;

        const battle_intensity = Math.floor(Math.ceil(Math.random() * this.status.intensity) * crit);


        const old_status = target.statuses.find((stats: Battle_Status) => stats.status.name == this.status.name);

        if(!old_status) {
            target.add_status(new Battle_Status(this.status, battle_intensity));
        } else {
            old_status.duration += this.status.duration;
            old_status.intensity += battle_intensity;
        }

        return target.health
    }
}