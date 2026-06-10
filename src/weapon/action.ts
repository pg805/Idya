export enum ActionType {
    None           = 0,
    Strike         = 1,
    Block          = 2,
    Buff           = 3,
    DamageOverTime = 4,
    Debuff         = 5,
    Heal           = 6,
    Reflect        = 7,
    Shield         = 8,
    // Board-effect types (0.2.0 positional layer)
    BlockTile      = 9,   // permanent tile; allies standing on it gain block = value each round
    BuffTile       = 10,  // permanent tile; allies standing on it gain +value to attack rolls
    HazardTile     = 11,  // permanent tile; opposing units that enter it take value damage
    DestroyObstacle = 12, // destroy a targeted obstacle, AOE its field to enemies within 1
    SlowTile       = 13,  // permanent tile; leaving it costs +1 movement (difficult terrain)
    MoveDebuff     = 14,  // unit-attached: caps the target's movement range to value for rounds turns
}

// Tile-creating actions drop tile(s) on a square (self for block/buff, aimed for
// hazard/slow). Area > 1 spreads them into an N×N block.
export const TILE_TYPES = new Set<number>([
    ActionType.BlockTile,
    ActionType.BuffTile,
    ActionType.HazardTile,
    ActionType.SlowTile,
]);

export const SELF_TARGET_TYPES = new Set<number>([
    ActionType.Block,
    ActionType.Buff,
    ActionType.Heal,
    ActionType.Reflect,
    ActionType.Shield,
]);

export default class Action {
    name: string
    action_string: string
    type: number = ActionType.None
    type_name: string = ''
    damage_type: string = ''
    damage_subtype: string = ''
    cost: number = 0
    range: number = 1
    area: number = 1   // N×N footprint: tiles placed / AOE hit (1 = single tile)
    push: number = 0   // rider: knock the struck target N squares away from the attacker
    smash: boolean = false // rider: an Area strike also flattens obstacles in the block (opening LOS through them)
    aimed: boolean = false
    targeted: boolean = false

    constructor(name: string, action_string: string) {
        this.name = name;
        this.action_string = action_string;
    }

    get_description() {
        return ''
    }
}
