import Item from "./item";
import { v4 as uuid } from 'uuid';
import Action from "./action";

export default class Character {

    constructor(
        public inventory: Item[] = [],
        public activeItems: Item[] = [],
        public totalHp: number = 0,
        public currentHp: number = 0,
        public id: string = uuid()
    ) { }

    setTotalHealth() {
        let totalHp = 0;

        this.activeItems.forEach((item: Item) => {
            totalHp += item.hp
        });

        this.totalHp = totalHp;
    }

    getActiveActions() {
        return this.activeItems.flatMap(
            item => item.actions
        )
    }
}