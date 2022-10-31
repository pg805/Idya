import Action from "./action";

export default class Item {
    constructor(
        public hp: number = 0,
        public name: string = '',
        public actions: Action[] = []
    ) { }
}
