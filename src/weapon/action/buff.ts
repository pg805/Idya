import Action from '../action.js';

export default class Buff extends Action {
    value: number
    rounds: number
    type = 3
    type_name = 'BUFF'

    constructor(name: string, action_string: string, value: number, rounds: number) {
        super(name, action_string);
        this.value = value;
        this.rounds = rounds;
    }

    get_description(): string {
        return `BUFF ${this.value} - ${this.rounds}R`
    }
}
