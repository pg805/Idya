import Character from "../character";
import Item from "../item";
import Pattern from "../pattern";

export default class NonPlayerCharacter extends Character {
    constructor(
        public pattern: Pattern = new Pattern(),
        public loot: Item[] = [],
    ) { super() }
}