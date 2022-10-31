import NonPlayerCharacter from "../types/character/nonPlayerCharacter"
import PlayerCharacter from "../types/character/playerCharacter"
import Item from "../types/item"
import Action from "../types/action"

export default class State {

    constructor(
        public playerCharacters: PlayerCharacter[] = [],
        public nonPlayerCharacters: NonPlayerCharacter[] = [],
        public definedIntents: Action[] = [],
        public round: number = 0,
        public loot: Item[] = [],
    ) { }

}