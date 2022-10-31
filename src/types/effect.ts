import EffectType from "./effectType";

export default class Effect {
    constructor(
        public effectType: EffectType = new EffectType(),
        public baseValue: number = 0,
        public randomValue: number = 0
    ) { }

    calculateDamage() {
        return this.baseValue + Math.floor(Math.random() * (this.randomValue + 1))
    }
}