import Result_Field from "../infrastructure/result_field.js"

export default class Weapon {
    name: string
    defend: number
    attack: Result_Field
    special: Result_Field

    constructor(name: string, defend: number, attack: Result_Field, special: Result_Field) {
        this.name = name
        this.defend = defend
        this.attack = attack
        this.special = special
    }
}
