import Action from '../action.js';

export default class Heal extends Action {
    value: number
    type = 6
    type_name = 'HEAL'

    constructor(name: string, action_string: string, value: number) {
        super(name, action_string);
        this.value = value;
    }

    get_description(): string {
        return `HEAL ${this.value}`
    }
}
