import Action from '../action.js';

export default class Reflect extends Action {
    value: number
    rounds: number
    type = 7
    type_name = 'REFLECT'

    constructor(name: string, value: number, rounds: number) {
        super(name);
        this.value = value;
        this.rounds = rounds;
    }
}
