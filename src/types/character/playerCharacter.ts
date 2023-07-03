import Character from "../character";
import Item, { ItemObject } from "../item";

export interface PlayerCharacterObject {
    userId: string,
    id: string,
    totalHP: number,
    currentHP: number,
    armor: number,
    inventory: ItemObject[]
    activeItems: ItemObject[]
}

export default class PlayerCharacter extends Character {
    constructor(
        public userId: string = "",
    ) { super() }

    toJSON(): PlayerCharacterObject {
        return {
            id: this.id,
            userId: this.userId,
            totalHP: this.totalHp,
            currentHP: this.currentHp,
            armor: this.armor,
            inventory: this.inventory.map((item: Item) => item.toJSON()),
            activeItems: this.activeItems.map((item: Item) => item.toJSON())
        }
    }

    static fromJSON(playerCharacterObject: PlayerCharacterObject): PlayerCharacter {
        const playerCharacter = new PlayerCharacter()

        playerCharacter.id = playerCharacterObject.id;
        playerCharacter.userId = playerCharacterObject.userId;
        playerCharacter.totalHp = playerCharacterObject.totalHP;
        playerCharacter.currentHp = playerCharacterObject.currentHP;
        playerCharacter.armor = playerCharacterObject.armor;
        playerCharacter.inventory = playerCharacterObject.inventory.map((itemObject: ItemObject) => Item.fromJSON(itemObject));
        playerCharacter.activeItems = playerCharacterObject.activeItems.map((itemObject: ItemObject) => Item.fromJSON(itemObject));

        return playerCharacter
    }
}