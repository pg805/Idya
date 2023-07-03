import { EFFECT } from "../combat_old/constant";
import { EffectType, EFFECT_TYPES } from "./effectType";

export interface EffectObject {
    type: string,
    baseValue: number,
    randomValue: number,
    critValue: number
}

export default class Effect {
    constructor(
        public effectType: EffectType = new EffectType(),
        public baseValue: number = 0,
        public randomValue: number = 0,
        public critValue: number = 1
    ) { }

    calculateValue(crit: Boolean) {
        const damage = this.baseValue + Math.floor(Math.random() * (this.randomValue + 1))
        return crit ? damage * this.critValue : damage;
    }

    toJSON(): EffectObject {
        return {
            type: this.effectType.type,
            baseValue: this.baseValue,
            randomValue: this.randomValue,
            critValue: this.critValue
        }
    }

    static fromJSON(effectObject: EffectObject): Effect {
        const effect: Effect = new Effect()

        const effectType: EffectType = new EffectType()
        if (effectObject.type == EFFECT_TYPES.BLOCK) {
            effectType.setBlock()
        } else if (effectObject.type == EFFECT_TYPES.DAMAGE) {
            effectType.setDamage()
        } else if (effectObject.type == EFFECT_TYPES.HEAL) {
            effectType.setHeal()
        }

        effect.effectType = effectType;
        effect.baseValue = effectObject.baseValue;
        effect.randomValue = effectObject.randomValue;
        effect.critValue = effectObject.critValue;

        return effect
    }
}