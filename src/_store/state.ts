import NonPlayerCharacter from "../types/character/nonPlayerCharacter"
import PlayerCharacter from "../types/character/playerCharacter"
import Item from "../types/item"
import Action from "../types/action"
import Character from "../types/character"

export default class State {

    constructor(
        public playerCharacters: PlayerCharacter[] = [],
        public nonPlayerCharacters: NonPlayerCharacter[] = [],
        public deadPlayers: Character[] = [],
        public definedIntents: Action[] = [],
        public round: number = 0,
        public loot: Item[] = [],
    ) { }

}
