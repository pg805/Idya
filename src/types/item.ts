import Action, {ActionObject} from "./action";

export interface ItemObject {
    hp: number,
    name: string,
    actions: ActionObject[];
}

export default class Item {
    constructor(
        public hp: number = 0,
        public name: string = '',
        public actions: Action[] = []
    ) { }

    toJSON(): ItemObject {
        return {
            hp: this.hp,
            name: this.name,
            actions: this.actions.map((action: Action) => action.toJSON())
        }
    }

    static fromJSON(itemObject: ItemObject): Item {
        const item = new Item()

        item.hp = itemObject.hp;
        item.name = itemObject.name;
        item.actions = itemObject.actions.map((actionObject: ActionObject) => Action.fromJSON(actionObject))

        return item
    }
}
