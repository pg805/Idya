import Weapon from '../weapon/weapon.js';

export default class Player_Character {
    name: string
    health: number
    weapon: Weapon
    image: string

    constructor(name: string, health: number, weapon: Weapon, image: string) {
        this.name = name;
        this.health = health;
        this.weapon = weapon;
        this.image = image;
    }
}
