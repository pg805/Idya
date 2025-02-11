import Action from "../action.js"

export default class Heal extends Action {
    value: number
    type: number = 6
    type_name: string = 'HEAL'

    constructor(name: string, value: number) {
        super(name)
        this.value = value
    }
}