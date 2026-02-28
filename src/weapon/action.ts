export default class Action {
    name: string
    action_string: string
    type: number = 0
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
