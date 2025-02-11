import Result_Field from "../infrastructure/result_field.js"
import Action from "./action.js"

export default class Weapon {
    name: string
    defend: Array<Action>
    attack: Array<Action>
    special: Array<Action>

    constructor(name: string, defend: Array<Action>, attack: Array<Action>, special: Array<Action>) {
        this.name = name
        this.defend = defend
        this.attack = attack
        this.special = special
    }
}
