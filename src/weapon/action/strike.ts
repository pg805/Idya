import Result_Field from '../../infrastructure/result_field.js';
import Action from '../action.js';

export default class Strike extends Action {
    field: Result_Field
    type = 1
    type_name = 'STRIKE'

    constructor(name: string, action_string: string, field: Result_Field) {
        super(name, action_string);
        this.field = field;
    }

    get_description(): string {
        return `STRIKE ${this.field}`
    }
}
