import Result_Field from '../../infrastructure/result_field.js';
import Action, { ActionType } from '../action.js';

export default class Strike extends Action {
    field: Result_Field
    type = ActionType.Strike
    type_name = 'STRIKE'

    constructor(name: string, action_string: string, field: Result_Field) {
        super(name, action_string);
        this.field = field;
    }

    get_description(): string {
        return `STRIKE [${this.field.field}]`
    }
}
