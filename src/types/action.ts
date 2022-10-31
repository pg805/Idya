import Effect from "./effect";
import ActionType from "./actionType";

export default class Action {

    constructor(
        public name: string = '',
        public actionType: ActionType = new ActionType(),
        public effect: Effect = new Effect(),
        public targetId: string = '',
        public originId: string = ''
    ) { }

}