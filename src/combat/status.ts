import Battle_Data from "./battle_data";
import Battle_Player from "./battle_player";

export class Status {
    duration: number;
    intensity: number;
    name: string;

    constructor(duration: number, intensity: number, name: string) {
        this.duration = duration;
        this.intensity = intensity;
        this.name = name;
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
        super(duration, intensity, name)
    }

    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        player.health = Math.max(player.health - intensity, 0);
    }
}

export class Health_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name)
    }

    end_of_turn_effect(player: Battle_Player, intensity: number, turn_data: Battle_Data): void {
        player.health += intensity;
    }
}

export class Damage_Reduction_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name)
    }

    action_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        return Math.max(amount - intensity, 0);
    }
}

export class Damage_Increase_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name)
    }

    apply_effect(amount: number, intensity: number, turn_data: Battle_Data): number {
        return amount + intensity;
    }
}