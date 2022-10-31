
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
        logger.debug(`Action - Adding effect group with requirement ${effect.target_req}`);   
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
        logger.debug(`Effect Group - Adding effect of type ${effect.type} to effect group`);
        this.effects.push(effect);
    }
}

type template = (values: {user: string; target: string; amount: number; crit: boolean}) => string;

// Effect needs to know user's attack type to determine crit
export class Effect {
    roll: number;
    // this might should change
    constant: number;
    critical: number;
    type: string;
    template: template;

    constructor(roll: number, constant: number, critical: number, type: string, template: template) {
        this.roll = roll;
        this.constant = constant;
        this.critical = critical;
        this.type = type;
        this.template = template;
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data) { return 0 }

    to_string(user: Battle_Player, target: Battle_Player, amount: number, crit: boolean):string {
        return this.template({
            user: user.name,
            target: target.name,
            amount: amount,
            crit: crit
        });
    }

    static create_template(strings: TemplateStringsArray, ...keys: string[]): template {
        logger.debug(`Action - Creating Template\nString Array: ${strings}\nkeys: ${keys}`);
        return (values: {user: string; target: string; amount: number; crit: boolean}) => {
            logger.debug(`Action - Creating String`);
            const result: string[] = [strings[0]];
            keys.forEach((key, i) => {
                logger.debug(`Action - Key: ${key} :: string ${i + 1}: ${strings[i + 1]} :: result: ${result} :: value: ${values[key as keyof Object]}`);
                if(values[key as keyof Object] != undefined) {
                    let value = String(values[key as keyof Object]);
                    if(key == 'crit') {
                            value = value == 'true' ? 'critically' : '';
                    }
                    result.push(value);
                    result.push(strings[i + 1]);
                }
            });
            logger.debug(`Action - result: ${result}\nresult joined: ${result.join('')}`);
            return result.join("");
          };
    }
}

export function check_crit(user_action: string, target_action: string) {
    
    if ((target_action == STATE.DEFEND && user_action == STATE.SPECIAL) ||
    (target_action == STATE.ATTACK && user_action == STATE.DEFEND) ||
    (target_action == STATE.SPECIAL && user_action == STATE.ATTACK)
    ) {
        logger.debug(`Check Crit - Checking Crit for action: True
User type ${user_action}
Target Type ${target_action}`)
        return true;
    }
    logger.debug(`Check Crit - Checking Crit for action: False
User type ${user_action}
Target Type ${target_action}`)
    return false;
}

export class Damage_Effect extends Effect {

    constructor(roll: number, constant: number, critical: number, template: template) {
        super(roll, constant, critical, EFFECT.DAMAGE, template);
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data) {

        let add_string: string = '';

        const crit_check = check_crit(user.battle_status, target.battle_status);

        logger.debug(`Damage Effect - Crit ${crit_check}`);

        const crit = crit_check ? this.critical : 1;

        let damage = Math.floor((Math.ceil(Math.random() * this.roll) + this.constant) * crit);

        user.statuses.forEach((stats: Battle_Status) => {
            logger.debug(`Effect - Checking Status ${stats.status.name} for Damage Effect.  Target Req: ${stats.status.target}`)
            if(stats.status.target != TARGET_REQ.SELF) {
                damage += stats.action_effect(damage, turn_data)
            }
        });

        target.statuses.forEach((stats: Battle_Status) => {
            logger.debug(`Effect - Checking Status ${stats.status.name} for Damage Effect.  Target Req: ${stats.status.target}`)
            if(stats.status.target == TARGET_REQ.SELF) {
                damage += stats.action_effect(damage, turn_data)
            }
        })

        damage = Math.max(damage, 0);

        logger.debug(`Effect - Damage Effect
User: ${user.name}
Target: ${target.name}
Crit: ${check_crit(user.battle_status, target.battle_status)}
damage: ${damage}
Target Original Health: ${target.health}
Target New Health: ${Math.max(target.health - damage, 0)}`);

        target.health = Math.max(target.health - damage, 0);

        add_string += this.to_string(user, target, damage, crit_check)

        turn_data.add_target(user, target, damage, EFFECT.DAMAGE, crit_check, add_string);

        return damage
    }
}

export class Heal_Effect extends Effect {

    constructor(roll: number, constant: number, critical: number, template: template) {
        super(roll, constant, critical, EFFECT.DAMAGE, template);
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data) {
        
        const crit_check = check_crit(user.battle_status, target.battle_status);
        
        logger.debug(`Healing Effect - Crit ${crit_check}`);

        const crit = crit_check ? this.critical : 1;
        
        let health = Math.floor((Math.ceil(Math.random() * this.roll) + this.constant) * crit);    
        
        user.statuses.forEach((stats: Battle_Status) => {
            logger.debug(`Effect - Checking Status ${stats.status.name} for Heal Effect.  Target Req: ${stats.status.target}`)
            if(stats.status.target != TARGET_REQ.SELF) {
                health += stats.action_effect(health, turn_data)
            }
        });

        target.statuses.forEach((stats: Battle_Status) => {
            logger.debug(`Effect - Checking Status ${stats.status.name} for Heal Effect.  Target Req: ${stats.status.target}`)
            if(stats.status.target == TARGET_REQ.SELF) {
                health += stats.action_effect(health, turn_data)
            }
        })

        health = Math.max(health, 0);

        logger.debug(`Effect - Heal Effect
User: ${user.name}
Target: ${target.name}
Crit: ${check_crit(user.battle_status, target.battle_status)}
Health: ${health}
Target Original Health: ${target.health}
Target Mew Health: ${Math.min(target.health + health, target.max_health)}`);

        target.health = Math.min(target.health + health, target.max_health);

        const add_string = this.to_string(user, target, health, crit_check)

        turn_data.add_target(user, target, health, EFFECT.HEAL, crit_check, add_string);

        return health
    }
}

export class Status_Effect extends Effect {
    status: Status

    constructor(status: Status, critical: number, template: template) {
        super(0, 0, critical, EFFECT.STATUS, template)
        this.status = status;
    }

    execute(user: Battle_Player, target: Battle_Player, turn_data: Battle_Data): number {

        const crit_check = check_crit(user.battle_status, target.battle_status);

        logger.debug(`Status Effect - Crit ${crit_check}`);

        const crit = crit_check ? this.critical : 1;

        const battle_intensity = Math.floor(Math.ceil(Math.random() * this.status.intensity) * crit);


        const old_status = target.statuses.find((stats: Battle_Status) => stats.status.name == this.status.name);

        logger.debug(`Effect - Status Effect
User: ${user.name}
Target: ${target.name}
Status: ${this.status.name}
Already Applied: ${!!old_status}
Crit: ${check_crit(user.battle_status, target.battle_status)}
Rolled Intensity: ${battle_intensity}
Total Intensity: ${!!old_status ? old_status.intensity + battle_intensity : battle_intensity}
Total Duration: ${!!old_status ? old_status.duration + this.status.duration : this.status.duration}`)
        if(!old_status) {
            target.add_status(new Battle_Status(this.status, battle_intensity));
        } else {
            old_status.duration += this.status.duration;
            old_status.intensity += battle_intensity;
        }

        const add_string = this.to_string(user, target, battle_intensity, crit_check)
        
        turn_data.add_target(user, target, battle_intensity, EFFECT.STATUS, crit_check, add_string);

        return target.health
    }
}