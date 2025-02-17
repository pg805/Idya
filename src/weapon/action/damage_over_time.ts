import Result_Field from '../../infrastructure/result_field.js';
import Action from '../action.js';

export default class Damage_Over_Time extends Action {
    field: Result_Field
    rounds: number
    type = 4
    type_name = 'DOT'

    constructor(name: string, action_string: string, field: Result_Field, rounds: number) {
        super(name, action_string);
        this.field = field;
        this.rounds = rounds;
    }
}
