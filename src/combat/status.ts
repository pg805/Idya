import logger from "../util/logger";
import Battle_Data from "./battle_data";
import Battle_Player from "./battle_player";
import { STATUS, TARGET_REQ } from "./constant";

type template = (values: {user: string; amount: number; }) => string;

export class Status {
    duration: number;
    intensity: number;
    name: string;
    target: string;
    type: string;
    template: template;

    constructor(duration: number, intensity: number, name: string, target: string, type: string, template: template) {
        this.duration = duration;
        this.intensity = intensity;
        this.name = name;
        this.target = target;
        this.type = type;
        this.template = template;
    }

    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        return
    }

    action_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        return 0
    }

    to_string(user: Battle_Player, amount: number):string {
        return this.template({
            user: user.name,
            amount: amount,
        });
    }

    static create_template(strings: TemplateStringsArray, ...keys: string[]): template {
        logger.debug(`Action - Creating Template\nString Array: ${strings}\nkeys: ${keys}`);
        return (values: {user: string; amount: number;}) => {
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

export class Damage_Status extends Status {
    constructor(duration: number, intensity: number, name: string, template: template) {
        super(duration, intensity, name, TARGET_REQ.SELF, STATUS.EOT, template)
    }

    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        logger.debug(`Status - Running end of turn damage effect ${this.name} on player ${player.name} with intensity ${intensity}`);
        player.health = Math.max(player.health - intensity, 0);
    }
}

export class Health_Status extends Status {
    constructor(duration: number, intensity: number, name: string, template: template) {
        super(duration, intensity, name, TARGET_REQ.SELF, STATUS.EOT, template)
    }
    
    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        logger.debug(`Status - Running end of turn heal effect ${this.name} on player ${player.name} with intensity ${intensity}`);
        player.health += intensity;
    }
}

export class Damage_Reduction_Status extends Status {
    constructor(duration: number, intensity: number, name: string, target: string, template: template) {
        super(duration, intensity, name, target, STATUS.ACTION, template)
    }
    
    action_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        logger.debug(`Status - Running action damage reduction effect ${this.name} with intensity ${intensity}`);
        return intensity  * -1;
    }
}

export class Damage_Increase_Status extends Status {
    constructor(duration: number, intensity: number, name: string, target: string, template: template) {
        super(duration, intensity, name, target, STATUS.ACTION, template)
    }
    
    apply_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        logger.debug(`Status - Running action damage increase effect ${this.name} with intensity ${intensity}`);
        return intensity;
    }
}