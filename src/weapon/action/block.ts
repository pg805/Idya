import Action, { ActionType } from '../action.js';

export default class Block extends Action {
    value: number
    type = ActionType.Block
    type_name = 'BLOCK'

    constructor(name: string, action_string: string, value: number) {
        super(name, action_string);
        this.value = value;
    }

    get_description(): string {
        return `BLOCK ${this.value}`
    }
}
