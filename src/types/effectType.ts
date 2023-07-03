export class EffectType {

    constructor(
        public type: string = 'NONE'
    ) { }

    setBlock() {
        this.type = EFFECT_TYPES.BLOCK
    }

    setDamage() {
        this.type = EFFECT_TYPES.DAMAGE
    }

    setHeal() {
        this.type = EFFECT_TYPES.HEAL
    }
}

export const EFFECT_TYPES = {
    BLOCK: "BLOCK",
    DAMAGE: "DAMAGE",
    HEAL: "HEAL",
}