import Action from "../action.js";

export default class Reflect extends Action {
    value: number
    rounds: number

    constructor(name: string, value: number, rounds: number) {
        super(name)
        this.value = value
        this.rounds = rounds
    }
}