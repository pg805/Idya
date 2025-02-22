import Action from '../action.js';

export default class Reflect extends Action {
    value: number
    rounds: number
    type = 7
    type_name = 'REFLECT'

    constructor(name: string, action_string: string, value: number, rounds: number) {
        super(name, action_string);
        this.value = value;
        this.rounds = rounds;
    }

    get_description(): string {
        return `REFLECT ${this.value} - ${this.rounds}R`
    }
}
