import Battle_Player from "./battle_player";
import { STATE, EFFECT, TARGET_REQ } from './constant';
import { Effect } from "./action";
import Battle_Data from "./battle_data";

export class Target_Group {
    effects: Array<Effect>
    targets: Array<Battle_Player>;
    requirement: string;

    constructor(effects: Array<Effect>, requirement: string) {
        this.effects = effects;
        this.requirement = requirement;
        this.targets = [];
    }

    satisfied(): boolean {
        return false
    }

    affect_targets(user: Battle_Player, turn_data: Battle_Data) {
        this.effects.forEach((effect: Effect) => {
            this.targets.forEach((target: Battle_Player) => {
                effect.execute(user, target, turn_data)
            })
        })
    }
}

export class Self_Target extends Target_Group {
    constructor(effects: Array<Effect>, user: Battle_Player) {
        super(effects, TARGET_REQ.SELF);
        this.targets= [user];
    }

    satisfied(): boolean {
        return true
    }
}

export class Group_Target extends Target_Group {
    constructor(effects: Array<Effect>, requirement: string, group: Array<Battle_Player>) {
        super(effects, requirement);
        this.targets = group;
    }

    satisfied(): boolean {
        return true
    }
}

export class Numbered_Target extends Target_Group {
    constructor(effects: Array<Effect>, requirement: number) {
        super(effects, requirement.toString())
    }

    targets_needed() {
        return parseInt(this.requirement) - this.targets.length;
    }

    add_target(player: Battle_Player) {
        this.targets.push(player);
    }

    add_targets(players: Array<Battle_Player>) {
        this.targets.concat(players)
    }

    satisfied(): boolean {
        if(parseInt(this.requirement) == this.targets.length) {
            return true
        }

        return false
    }
}