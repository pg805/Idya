import Action from "../action.js";

export default class Block extends Action {
    value: number
    type: number = 2
    type_name: string = 'BLOCK'

    constructor (name: string, value: number) {
        super(name)
        this.value = value
    }
}