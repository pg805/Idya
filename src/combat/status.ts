import logger from "../util/logger";
import Battle_Data from "./battle_data";
import Battle_Player from "./battle_player";
import { STATUS, TARGET_REQ } from "./constant";

export class Status {
    duration: number;
    intensity: number;
    name: string;
    target: string;
    type: string;

    constructor(duration: number, intensity: number, name: string, target: string, type: string) {
        this.duration = duration;
        this.intensity = intensity;
        this.name = name;
        this.target = target;
        this.type = type
    }

    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        return
    }

    action_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        return 0
    }
}

export class Damage_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name, TARGET_REQ.SELF, STATUS.EOT)
    }

    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        logger.debug(`Status - Running end of turn damage effect ${this.name} on player ${player.name} with intensity ${intensity}`);
        player.health = Math.max(player.health - intensity, 0);
    }
}

export class Health_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name, TARGET_REQ.SELF, STATUS.EOT)
    }
    
    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        logger.debug(`Status - Running end of turn heal effect ${this.name} on player ${player.name} with intensity ${intensity}`);
        player.health += intensity;
    }
}

export class Damage_Reduction_Status extends Status {
    constructor(duration: number, intensity: number, name: string, target: string) {
        super(duration, intensity, name, target, STATUS.ACTION)
    }
    
    action_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        logger.debug(`Status - Running action damage reduction effect ${this.name} with intensity ${intensity}`);
        return intensity  * -1;
    }
}

export class Damage_Increase_Status extends Status {
    constructor(duration: number, intensity: number, name: string, target: string) {
        super(duration, intensity, name, target, STATUS.ACTION)
    }
    
    apply_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        logger.debug(`Status - Running action damage increase effect ${this.name} with intensity ${intensity}`);
        return intensity;
    }
}