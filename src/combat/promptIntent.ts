import NonPlayerCharacter from "../types/character/nonPlayerCharacter";
import ActionType, { ActionTypes } from "../types/actionType";
import State from "../_store/state";
import Action from "../types/action";
import PlayerCharacter from "../types/character/playerCharacter";
import { promptUser } from "../discord/combat/promptIntent";
import logger from "../util/logger";
import Item from "../types/item";

// define npc intent
export const defineNpcIntent = (state: State) => {
    state.nonPlayerCharacters.forEach((npc: NonPlayerCharacter) => {
        const actionType = new ActionType();
        const deviation: number = Math.ceil(Math.random() * 100)
        let actionIndex = 0;

        if (deviation <= npc.pattern.deviationPercent) {
            actionIndex = Math.floor(Math.random() * npc.pattern.sequence.length)
            
            npc.pattern.currentIndex = actionIndex;
        } else {
            actionIndex = npc.pattern.currentIndex;
            npc.pattern.currentIndex = (npc.pattern.currentIndex + 1) % npc.pattern.sequence.length
        }

        const actionValue = npc.pattern.sequence[actionIndex]
        actionType.type = ActionTypes[actionValue]

        logger.debug(`
Selecting NPC Intent
NPC Deviation Roll: ${deviation}
NPC Deviation Percent: ${npc.pattern.deviationPercent}
Action Type Selected: ${actionType.type}
Action Index (next action if no deviation): ${npc.pattern.currentIndex}
`)

        const potentialActions: Action[] = npc.getActiveActions().filter(action => action.actionType.type === actionType.type)
        const selectedAction: Action = potentialActions[0]

        // TODO: Choose target here
        selectedAction.targetId = state.playerCharacters[0].id;
        selectedAction.originId = npc.id
        updateIntents(state, selectedAction)
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

export const definePCIntent = (state: State, actionName: string, origin: string, target: string) => {
    const originPlayer = state.playerCharacters.find((pc: PlayerCharacter) => {
        return pc.id === origin
    })

    if (originPlayer) {
        const foundAction = originPlayer.activeItems.flatMap((item: Item) => {
            return item.actions.find((action: Action) => {
                return action.name === actionName
            })
        })[0]

        if (foundAction) {
            const selectedAction: Action = structuredClone(foundAction)
            selectedAction.targetId = target;
            selectedAction.originId = origin
            updateIntents(state, selectedAction)
        } else {
            logger.warn(`
Cannot find action for PC intent
Origin ID: ${origin}
Target ID: ${target}
Action Name: ${actionName}
`)
        }

    } else {
        logger.warn(`
Cannot find player for PC intent
Origin ID: ${origin}
Target ID: ${target}
Action Name: ${actionName}
`)
        return
    }
}

// update intents
const updateIntents = (state: State, action: Action): void => {
    const prevDefinedIntents = state.definedIntents
    const duplicateDefinedIntents = prevDefinedIntents.find((definedIntent: Action) => {
        definedIntent.originId === action.originId
    })
    if (duplicateDefinedIntents) {
        // end and log
        logger.warn(`
Duplicate Intent Found:
Action Name: ${duplicateDefinedIntents.name}
Action Type: ${duplicateDefinedIntents.actionType.type}
Target: ${duplicateDefinedIntents.targetId}
Origin: ${duplicateDefinedIntents.originId}
`)
        return
    } else {
        const newDefinedIntents = [...prevDefinedIntents, action]
        state.definedIntents = newDefinedIntents
    }
    // log new defined intents
    logger.info(`
Currently Defined Intents
-------------------------
${state.definedIntents.map((action: Action) => {
    return action.originId + ' -> ' + action.targetId + ' : ' + action.actionType.type + ' : ' + action.name
}).join('\n')}
`)
}

