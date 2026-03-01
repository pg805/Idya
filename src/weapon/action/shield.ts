import Action, { ActionType } from '../action.js';

export default class Shield extends Action {
    value: number
    rounds: number
    type = ActionType.Shield
    type_name = 'SHIELD'

    constructor(name: string, action_string: string, value: number, rounds: number) {
        super(name, action_string);
        this.value = value;
        this.rounds = rounds;
    }

    get_description(): string {
        return `SHIELD ${this.value} - ${this.rounds}R`
    }
}
