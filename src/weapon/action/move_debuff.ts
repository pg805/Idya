import Action, { ActionType } from '../action.js';

// Unit-attached movement debuff (e.g. Dagger's Cut Tendons). While active it caps
// the target's effective movement range to `value` for `rounds` turns — distinct
// from the positional SlowTile (which lives on a board square). `value` is the
// movement cap, not a damage amount.
export default class MoveDebuff extends Action {
    value: number
    rounds: number
    type = ActionType.MoveDebuff
    type_name = 'MOVE DEBUFF'

    constructor(name: string, action_string: string, value: number, rounds: number) {
        super(name, action_string);
        this.value = value;
        this.rounds = rounds;
    }

    get_description(): string {
        return `MOVE→${this.value} - ${this.rounds}R`
    }
}
