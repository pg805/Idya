import Action from "../action.js";

export default class Debuff extends Action {
    value: number
    rounds: number
    type: number = 5
    type_name: string = 'DEBUFF'

    constructor (name: string, value: number, rounds: number) {
        super(name)
        this.value = value
        this.rounds = rounds
    }
}