import Result_Field from "../infrastructure/result_field.js"
import Action from "./action.js"

export default class Weapon {
    name: string
    defend: Array<Action>
    defend_crit: Array<Action>
    attack: Array<Action>
    attack_crit: Array<Action>
    special: Array<Action>
    special_crit: Array<Action>

    constructor(name: string, defend: Array<Action>, defend_crit: Array<Action>, attack: Array<Action>, attack_crit: Array<Action>, special: Array<Action>, special_crit: Array<Action>) {
        this.name = name
        this.defend = defend
        this.defend_crit = defend_crit
        this.attack = attack
        this.attack_crit = attack_crit
        this.special = special
        this.special_crit = special_crit
    }
}
