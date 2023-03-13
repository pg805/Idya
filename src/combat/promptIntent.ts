import NonPlayerCharacter from "../types/character/nonPlayerCharacter";
import ActionType, { ActionTypes } from "../types/actionType";
import { state } from "../_store/state";
import Action from "../types/action";
import PlayerCharacter from "../types/character/playerCharacter";
import { promptUser } from "../discord/combat/promptIntent";


// define npc intent
export const defineNpcIntent = () => {
    state.nonPlayerCharacters.forEach((npc: NonPlayerCharacter) => {
        const actionType = new ActionType();
        if (Math.ceil(Math.random() * 100) <= npc.pattern.deviationPercent) {
            const actionIndex = Math.floor(Math.random() * npc.pattern.sequence.length)
            const actionValue = npc.pattern.sequence[actionIndex]

            actionType.type = ActionTypes[actionValue]
        }

        const potentialActions: Action[] = npc.getActiveActions().filter(action => action.actionType.type === actionType.type)
        const selectedAction: Action = potentialActions[0]

        selectedAction.targetId = state.playerCharacters[0].id;
        selectedAction.originId = npc.id
        updateIntents(selectedAction)
    })
}
/* 
prompt players for intent selection 
    - keep in mind one action type can 
    have multiple actions to be selected
    - give confirmation message that 
    action has been selected and 
    we are waiting on other players
*/

export const definePCIntent = () => {
    state.playerCharacters.forEach((pc: PlayerCharacter) => {
        promptUser(pc);
    })
}

// update intents
const updateIntents = (action: Action): void => {
    const prevDefinedIntents = state.definedIntents
    const duplicateDefinedIntents = prevDefinedIntents.find(definedIntents => {
        definedIntents.originId === action.originId
    })
    if (duplicateDefinedIntents) {
        // end and log
        return
    } else {
        const newDefinedIntents = [...prevDefinedIntents, action]
        state.definedIntents = newDefinedIntents
    }
    // log new defined intents
}

