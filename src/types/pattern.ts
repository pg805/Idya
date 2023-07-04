export interface PatternObject {
    sequence: number[],
    deviationPercent: number
}

export default class Pattern {
    constructor (
        public sequence: number[] = [],
        public deviationPercent: number = 0
    ) {}

    toJSON(): PatternObject {
        return {
            sequence: this.sequence,
            deviationPercent: this.deviationPercent
        }
    }

    static fromJSON(patternObject: PatternObject): Pattern {
        const pattern = new Pattern()

        pattern.sequence = patternObject.sequence;
        pattern.deviationPercent = patternObject.deviationPercent;

        return pattern
    }
}