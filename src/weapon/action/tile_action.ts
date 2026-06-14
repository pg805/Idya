import Action from '../action.js';

// Block Tile (9) / Buff Tile (10) / Hazard Tile (11). The action's `type` carries
// which kind; `value` is the block / buff / damage amount. Placed on the caster's
// own square (permanent, overwrites any tile already there).
export default class TileAction extends Action {
    value: number;

    constructor(name: string, action_string: string, type: number, value: number) {
        super(name, action_string);
        this.type = type;
        this.value = value;
    }

    get_description(): string {
        return `${this.type_name} ${this.value}`;
    }
}
