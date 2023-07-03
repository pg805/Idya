import Effect, { EffectObject } from "./effect";
import ActionType, { ACTION_TYPES } from "./actionType";

export interface ActionObject {
    name: string,
    actionType: string,
    effect: EffectObject,
    targetId: string,
    originId: string
}

export default class Action {

    constructor(
        public name: string = '',
        public actionType: ActionType = new ActionType(),
        public effect: Effect = new Effect(),
        public targetId: string = '',
        public originId: string = ''
    ) { }

    toJSON(): ActionObject {
        return {
            name: this.name,
            actionType: this.actionType.type,
            effect: this.effect.toJSON(),
            targetId: this.targetId,
            originId: this.originId
        }
    }

    static fromJSON(actionObject: ActionObject): Action {
        const action = new Action();
        const actionType = new ActionType();

        if (actionObject.actionType == ACTION_TYPES.ATTACK) {
            actionType.setAttack()
        } else if (actionObject.actionType == ACTION_TYPES.DEFEND) {
            actionType.setDefend()
        } else if (actionObject.actionType == ACTION_TYPES.SPECIAL) {
            actionType.setSpecial()
        }

        action.actionType = actionType;
        action.effect = Effect.fromJSON(actionObject.effect);
        action.name = actionObject.name;
        action.originId = actionObject.originId;
        action.targetId = actionObject.targetId;

        return action;
    }
}