import Weapon from "../item/weapon.js"

export default class Player_Character {
    name: string
    health: number
    weapon: Weapon

    constructor(name: string, health: number, weapon: Weapon) {
        this.name = name
        this.health = health
        this.weapon = weapon
    }
}