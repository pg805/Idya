export enum ActionType {
    None           = 0,
    Strike         = 1,
    Block          = 2,
    Buff           = 3,
    DamageOverTime = 4,
    Debuff         = 5,
    Heal           = 6,
    Reflect        = 7,
    Shield         = 8
}

export default class Action {
    name: string
    action_string: string
    type: number = ActionType.None
    type_name: string = ''
    damage_type: string = ''
    damage_subtype: string = ''
    cost: number = 0

    constructor(name: string, action_string: string) {
        this.name = name;
        this.action_string = action_string;
    }

    get_description() {
        return ''
    }
}
