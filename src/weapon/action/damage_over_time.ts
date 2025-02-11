import Result_Field from "../../infrastructure/result_field.js";
import Action from "../action.js";

export default class Damage_Over_Time extends Action {
    field: Result_Field
    rounds: number
    type: number = 4
    type_name: string = 'DOT'

    constructor(name: string, field: Result_Field, damage_time: number) {
        super(name)
        this.field = field
        this.rounds = damage_time
    }
}