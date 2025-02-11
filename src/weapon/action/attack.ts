import Result_Field from "../../infrastructure/result_field.js";
import Action from "../action.js";

export default class Attack extends Action {
    field: Result_Field

    constructor(name: string, field: Result_Field) {
        super(name)
        this.field = field
    }
}