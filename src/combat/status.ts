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

    end_of_turn_effect(player: Battle_Player, intensity: number): void {
        return
    }

    action_effect(amount: number, intensity: number): number {
        return 0
    }
}

export class Damage_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name)
    }

    end_of_turn_effect(player: Battle_Player, intensity: number): void {
        player.health = Math.max(player.health - intensity, 0);
    }
}

export class Health_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name)
    }

    end_of_turn_effect(player: Battle_Player, intensity: number): void {
        player.health += intensity;
    }
}

export class Damage_Reduction_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name)
    }

    action_effect(amount: number, intensity: number): number {
        return Math.max(amount - intensity, 0);
    }
}

export class Damage_Increase_Status extends Status {
    constructor(duration: number, intensity: number, name: string) {
        super(duration, intensity, name)
    }

    apply_effect(amount: number, intensity: number): number {
        return amount + intensity;
    }
}