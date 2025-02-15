import Result_Field from '../../infrastructure/result_field.js';
import Action from '../action.js';

export default class Strike extends Action {
    field: Result_Field
    type = 1
    type_name = 'STRIKE'

    constructor(name: string, field: Result_Field) {
        super(name);
        this.field = field;
    }
}
