import Action from '../action.js';

export default class Debuff extends Action {
    value: number
    rounds: number
    type = 5
    type_name = 'DEBUFF'

    constructor(name: string, value: number, rounds: number) {
        super(name);
        this.value = value;
        this.rounds = rounds;
    }
}
