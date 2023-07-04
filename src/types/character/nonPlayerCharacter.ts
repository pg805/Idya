import Character from "../character";
import Item, { ItemObject } from "../item";
import Pattern, { PatternObject } from "../pattern";

export interface NonPlayerCharacterObject {
    id: string,
    totalHP: number,
    currentHP: number,
    armor: number,
    inventory: ItemObject[],
    activeItems: ItemObject[],
    pattern: PatternObject,
    loot: ItemObject[]
}

export default class NonPlayerCharacter extends Character {
    constructor(
        public pattern: Pattern = new Pattern(),
        public loot: Item[] = [],
    ) { super() }

    toJSON(): NonPlayerCharacterObject {
        return {
            id: this.id,
            totalHP: this.totalHp,
            currentHP: this.currentHp,
            armor: this.armor,
            inventory: this.inventory.map((item: Item) => item.toJSON()),
            activeItems: this.activeItems.map((item: Item) => item.toJSON()),
            pattern: this.pattern.toJSON(),
            loot: this.loot.map((item: Item) => item.toJSON())
        }
    }

    static fromJSON(nonPlayerCharacterObject: NonPlayerCharacterObject): NonPlayerCharacter {
        const nonPlayerCharacter = new NonPlayerCharacter()

        nonPlayerCharacter.id = nonPlayerCharacterObject.id;
        nonPlayerCharacter.totalHp = nonPlayerCharacterObject.totalHP;
        nonPlayerCharacter.currentHp = nonPlayerCharacterObject.currentHP;
        nonPlayerCharacter.armor = nonPlayerCharacterObject.armor;
        nonPlayerCharacter.inventory = nonPlayerCharacterObject.inventory.map((itemObject: ItemObject) => Item.fromJSON(itemObject));
        nonPlayerCharacter.activeItems = nonPlayerCharacterObject.activeItems.map((itemObject: ItemObject) => Item.fromJSON(itemObject));
        nonPlayerCharacter.pattern = Pattern.fromJSON(nonPlayerCharacterObject.pattern)
        nonPlayerCharacter.loot = nonPlayerCharacterObject.loot.map((itemObject: ItemObject) => Item.fromJSON(itemObject));

        return nonPlayerCharacter
    }
}