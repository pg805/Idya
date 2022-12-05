import ActionType, { ActionTypes } from "../types/actionType";
import Action from "../types/action";
import State from "../_store/state";
import PlayerCharacter from "../types/character/playerCharacter";

function getDefenders(state: State) {
    return state.definedIntents.filter((action: Action) => {
        action.actionType.type == ActionTypes[0]
    })
}

function getAttackers(state: State) {
    return state.definedIntents.filter((action: Action) => {
        action.actionType.type == ActionTypes[1]
    })
}
function getSpecialers(state: State) {
    return state.definedIntents.filter((action: Action) => {
        action.actionType.type == ActionTypes[2]
    })
}

function checkDeaths(state: State) {
    state.playerCharacters.filter((pc: PlayerCharacter) => {
        if (pc.currentHp <= 0) {
            state.deadPlayers.push(pc);
            return false
        } else {
            return true
        }
    })

    state.nonPlayerCharacters.filter((npc: PlayerCharacter) => {
        if (npc.currentHp <= 0) {
            state.deadPlayers.push(npc);
            return false
        } else {
            return true
        }
    })
}

// NPCs vs PCs?
function checkWin(state: State) {

}