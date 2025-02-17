export default class Action {
    name: string
    action_string: string
    type: number = 0
    type_name: string = ''

    constructor(name: string, action_string: string) {
        this.name = name;
        this.action_string = action_string;
    }
}
