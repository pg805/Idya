import Action from "../action.js";

export default class Shield extends Action {
    value: number
    rounds: number
    type: number = 8
    type_name: string = 'SHIELD'

    constructor(name: string, value: number, rounds: number) {
        super(name)
        this.value = value
        this.rounds = rounds
    }
}