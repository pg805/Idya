import Item from "./item";
import { v4 as uuid } from 'uuid';
import Action from "./action";
import PlayerCharacter from "./character/playerCharacter";
import NonPlayerCharacter from "./character/nonPlayerCharacter";

export interface CharacterObject {

}

export default class Character {

    constructor(
        public inventory: Item[] = [],
        public activeItems: Item[] = [],
        public totalHp: number = 0,
        public currentHp: number = 0,
        public armor: number = 0,
        public id: string = uuid()
    ) { }

    setTotalHealth() {
        let totalHp = 0;

        this.activeItems.forEach((item: Item) => {
            totalHp += item.hp
        });

        this.totalHp = totalHp;
    }

    getActiveActions() {
        return this.activeItems.flatMap(
            item => item.actions
        )
    }

    toJSON(): CharacterObject {
        return {}
    }

    static fromJSON(characterObject: CharacterObject): Character {
        return new Character()
    }

    static isPC(character: Character): character is PlayerCharacter {
        return 'userId' in character
    }

    static isNPC(character: Character): character is NonPlayerCharacter {
        return 'loot' in self && 'pattern' in self
    }
}