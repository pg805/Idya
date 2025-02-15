import Action from '../action.js';

export default class Buff extends Action {
    value: number
    rounds: number
    type = 3
    type_name = 'BUFF'

    constructor(name: string, value: number, rounds: number) {
        super(name);
        this.value = value;
        this.rounds = rounds;
    }
}
