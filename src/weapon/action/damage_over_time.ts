import Result_Field from '../../infrastructure/result_field.js';
import Action, { ActionType } from '../action.js';

export default class Damage_Over_Time extends Action {
    field: Result_Field
    rounds: number
    type = ActionType.DamageOverTime
    type_name = 'DOT'

    constructor(name: string, action_string: string, field: Result_Field, rounds: number) {
        super(name, action_string);
        this.field = field;
        this.rounds = rounds;
    }

    get_description(): string {
        return `DOT [${this.field.field}] - ${this.rounds}R`
    }
}
