import Pattern from "../infrastructure/pattern.js"
import Weapon from "../weapon/weapon.js"
import Player_Character from "./player_character.js"

export default class Non_Player_Character extends Player_Character {
    pattern: Pattern

    constructor(name: string, health: number, pattern: Pattern, weapon: Weapon) {
        super(name=name, health=health, weapon=weapon)
        this.pattern = pattern
    }
}