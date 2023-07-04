import NonPlayerCharacter, { NonPlayerCharacterObject } from "../types/character/nonPlayerCharacter"
import PlayerCharacter, { PlayerCharacterObject } from "../types/character/playerCharacter"
import Item, { ItemObject } from "../types/item"
import Action, { ActionObject } from "../types/action"
import Character, { CharacterObject } from "../types/character"
import { v4 as uuidv4 } from 'uuid';

export interface StateObject {
    id: string,
    playerCharacters: PlayerCharacterObject[],
    nonPlayerCharacters: NonPlayerCharacterObject[],
    deadCharacters: (PlayerCharacterObject|NonPlayerCharacterObject|CharacterObject)[],
    definedIntents: ActionObject[],
    round: number,
    loot: ItemObject[]
}

export default class State {

    constructor(
        public id: string = '',
        public playerCharacters: PlayerCharacter[] = [],
        public nonPlayerCharacters: NonPlayerCharacter[] = [],
        public deadCharacters: Character[] = [],
        public definedIntents: Action[] = [],
        public round: number = 0,
        public loot: Item[] = [],
    ) { }

    toJSON(): StateObject {
        return {
            id: this.id,
            round: this.round,
            playerCharacters: this.playerCharacters.map((pc: PlayerCharacter) => pc.toJSON()),
            nonPlayerCharacters: this.nonPlayerCharacters.map((npc: NonPlayerCharacter) => npc.toJSON()),
            deadCharacters: this.deadCharacters.map((character: Character) => {
                if (Character.isPC(character)) {
                    return character.toJSON()
                } else if (Character.isNPC(character)) {
                    return character.toJSON()
                } else {
                    return character.toJSON()
                }
            }),
            definedIntents: this.definedIntents.map((action: Action) => action.toJSON()),
            loot: this.loot.map((item: Item) => item.toJSON())
        }
    }

    static fromJSON(stateObject: StateObject): State {
        const state: State = new State();

        state.id = stateObject.id;
        state.round = stateObject.round;
        state.definedIntents = stateObject.definedIntents.map((actionObject: ActionObject) => Action.fromJSON(actionObject));
        state.playerCharacters = stateObject.playerCharacters.map((playerCharacterObject: PlayerCharacterObject) => PlayerCharacter.fromJSON(playerCharacterObject));
        state.nonPlayerCharacters = stateObject.nonPlayerCharacters.map((nonPlayerCharacterObject: NonPlayerCharacterObject) => NonPlayerCharacter.fromJSON(nonPlayerCharacterObject));
        state.deadCharacters = stateObject.deadCharacters.map((character: (PlayerCharacterObject | NonPlayerCharacterObject | CharacterObject)) => {
            if (Character.isPCObject(character)) {
                return PlayerCharacter.fromJSON(character)
            } else if (Character.isNPCObject(character)) {
                return NonPlayerCharacter.fromJSON(character)
            } else {
                return Character.fromJSON(character)
            }
        })

        return state
    }

}

// gets called from init.ts
export const initializeState = () => {
    const state = new State();
    state.id = uuidv4();
    // sync up with backend
}
