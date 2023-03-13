export default class ActionType {

    constructor(
        public type: string = 'NONE'
    ) { }

    setDefend() {
        this.type = ACTION_TYPES.DEFEND
    }

    setAttack() {
        this.type = ACTION_TYPES.ATTACK
    }

    setSpecial() {
        this.type = ACTION_TYPES.SPECIAL
    }
}

export const ACTION_TYPES = {
    DEFEND: "DEFEND",
    ATTACK: "ATTACK",
    SPECIAL: "SPECIAL",
}

export const ActionTypes: string[] = [
    "DEFEND", "ATTACK", "SPECIAL",
] 