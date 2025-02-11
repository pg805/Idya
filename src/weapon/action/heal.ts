import Action from "../action.js"

export default class Heal extends Action {
    value: number

    constructor(name: string, value: number) {
        super(name)
        this.value = value
    }
}