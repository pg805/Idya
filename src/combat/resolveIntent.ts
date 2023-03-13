import ActionType, { ACTION_TYPES } from "../types/actionType";
import EffectType, { EFFECT_TYPES } from "../types/effectType";
import Action from "../types/action";
import State from "../_store/state";
import PlayerCharacter from "../types/character/playerCharacter";
import NonPlayerCharacter from "../types/character/nonPlayerCharacter";
import Character from "../types/character";

function getDefendActions(state: State): Action[] {
    return state.definedIntents.filter((action: Action) => {
        action.actionType.type == ACTION_TYPES.DEFEND
    })
}

function getAttackActions(state: State): Action[] {
    return state.definedIntents.filter((action: Action) => {
        action.actionType.type == ACTION_TYPES.ATTACK
    })
}
function getSpecialActions(state: State): Action[] {
    return state.definedIntents.filter((action: Action) => {
        action.actionType.type == ACTION_TYPES.SPECIAL
    })
}

function determineCriticalAction(originAction: ActionType, targetAction: ActionType): Boolean {
    if (originAction.type === ACTION_TYPES.DEFEND && targetAction.type === ACTION_TYPES.ATTACK) return true;
    if (originAction.type === ACTION_TYPES.ATTACK && targetAction.type === ACTION_TYPES.SPECIAL) return true;
    if (originAction.type === ACTION_TYPES.SPECIAL && targetAction.type === ACTION_TYPES.DEFEND) return true;
    return false;
}

type CharacterHealthAmorResultType = [number, number]
function calculateCharacterHealthArmor(currentHp: number, armor: number, actionValue: number, actionEffectType: EffectType): CharacterHealthAmorResultType {
    switch (actionEffectType.type) {
        case EFFECT_TYPES.BLOCK:
            return [currentHp, armor + actionValue];
        case EFFECT_TYPES.DAMAGE:
            const difference = armor - actionValue;
            const newHp = difference >= 0 ? currentHp : currentHp + difference;
            const newArmor = difference >= 0 ? difference : 0;

            return [newHp, newArmor]
        case EFFECT_TYPES.HEAL:
            return [currentHp + actionValue, armor];
    }
    return [currentHp, armor];
}

function resolveActions(actions: Action[], state: State) {
    actions.forEach((action: Action) => {
        // find target's action
        const targetAction = state.definedIntents.find((definedIntent: Action) => {
            return definedIntent.originId === action.targetId
        })
        const deadCharacterIds = state.deadCharacters.map((character: Character): string => character.id);
        // check if action is being performed by or on a dead character. if so, skip, otherwise continue
        if (!deadCharacterIds.includes(action.originId) && !deadCharacterIds.includes(action.targetId)) {
            // determine if action is crit
            const isCrit = targetAction ? determineCriticalAction(action.actionType, targetAction.actionType) : false;
            // get damage
            const actionValue = action.effect.calculateValue(isCrit);
            // resolve damage
            const characters = [...state.playerCharacters, ...state.nonPlayerCharacters];
            const target = characters.find((character: Character): Character | void => {
                character.id === action.targetId
            });
            
            // Determine if target is player character or npc
            state.playerCharacters = state.playerCharacters.map((pc: PlayerCharacter): PlayerCharacter => {
                if (pc.id === target?.id) {
                    const [currentHp, armor] = calculateCharacterHealthArmor(pc.currentHp, pc.armor, actionValue, action.effect.effectType);
                    pc.currentHp = currentHp;
                    pc.armor = armor;
                }
                return pc;
            })
            
            // Determine if target is player character or npc
            state.nonPlayerCharacters = state.nonPlayerCharacters.map((npc: NonPlayerCharacter): NonPlayerCharacter => {
                if (npc.id === target?.id) {
                    const [currentHp, armor] = calculateCharacterHealthArmor(npc.currentHp, npc.armor, actionValue, action.effect.effectType);
                    npc.currentHp = currentHp;
                    npc.armor = armor;
                }
                return npc;
            })
        }
    })
}

function resolveDeaths(state: State): void {
    state.playerCharacters = state.playerCharacters.filter((pc: PlayerCharacter): Boolean => {
        if (pc.currentHp <= 0) {
            state.deadCharacters.push(pc);
            return false
        } else {
            return true
        }
    })

    state.nonPlayerCharacters = state.nonPlayerCharacters.filter((npc: NonPlayerCharacter): Boolean => {
        if (npc.currentHp <= 0) {
            state.deadCharacters.push(npc);
            return false
        } else {
            return true
        }
    })

    state.deadCharacters = state.deadCharacters.map((character: Character): Character => {
        character.currentHp = 0;
        return character;
    })

    state.playerCharacters = state.playerCharacters.map((pc: PlayerCharacter): PlayerCharacter => {
        if(pc.currentHp > pc.totalHp) pc.currentHp = pc.totalHp;
        return pc;
    });

    state.nonPlayerCharacters = state.nonPlayerCharacters.map((npc: NonPlayerCharacter): NonPlayerCharacter => {
        if(npc.currentHp > npc.totalHp) npc.currentHp = npc.totalHp;
        return npc;
    });
}

type WinnerResultType = 'pc' | 'npc' | '';
// TODO
// NPCs vs PCs?
function getWinners(state: State): WinnerResultType {
    const playerCharactersRemaining = state.playerCharacters.length;
    const nonPlayerCharactersRemaining = state.nonPlayerCharacters.length;
    if (playerCharactersRemaining > 0 && nonPlayerCharactersRemaining > 0) return '';
    else if (playerCharactersRemaining > 0 && nonPlayerCharactersRemaining === 0) return 'pc';
    return 'npc';
}

function reset(state: State) {
    // reset armor
    state.playerCharacters = state.playerCharacters.map((pc: PlayerCharacter): PlayerCharacter => {
        pc.armor = 0;
        return pc;
    })

    state.nonPlayerCharacters = state.nonPlayerCharacters.map((npc: NonPlayerCharacter): NonPlayerCharacter => {
        npc.armor = 0;
        return npc;
    })
}

// TODO
function resolveRound(state: State): WinnerResultType {
    let winners: WinnerResultType = '';
    // Do Defend Actions
    const defendActions = getDefendActions(state);
    resolveActions(defendActions, state);

    // TODO: Turn this into a single function
    resolveDeaths(state);
    winners = getWinners(state);
    if (winners) return winners;
    // end single function

    // Do Attack Actions
    const attackActions = getAttackActions(state);
    resolveActions(attackActions, state);
    resolveDeaths(state);
    winners = getWinners(state);
    if (winners) return winners;

    // Do Special Actions
    const specialActions = getSpecialActions(state);
    resolveActions(specialActions, state);
    
    resolveDeaths(state);
    winners = getWinners(state);
    if (winners) return winners;

    // Reset round
    reset(state);

    return winners;
}