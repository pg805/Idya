import Action from '../action.js';

export default class Debuff extends Action {
    value: number
    rounds: number
    type = 5
    type_name = 'DEBUFF'

    constructor(name: string, action_string: string, value: number, rounds: number) {
        super(name, action_string);
        this.value = value;
        this.rounds = rounds;
    }

    get_description(): string {
        return `DEBUFF ${this.value} ROUNDS ${this.rounds}`
    }
}
