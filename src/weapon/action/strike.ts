import Result_Field from "../../infrastructure/result_field.js";
import Action from "../action.js";

export default class Strike extends Action {
    field: Result_Field
    type: number = 1
    type_name: string = 'STRIKE'

    constructor(name: string, field: Result_Field) {
        super(name)
        this.field = field
    }
}