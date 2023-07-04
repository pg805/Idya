export interface PatternObject {
    sequence: number[],
    deviationPercent: number,
    currentIndex: number
}

export default class Pattern {
    constructor (
        public sequence: number[] = [],
        public deviationPercent: number = 0,
        public currentIndex: number = 0
    ) {}

    toJSON(): PatternObject {
        return {
            sequence: this.sequence,
            deviationPercent: this.deviationPercent,
            currentIndex: this.currentIndex
        }
    }

    static fromJSON(patternObject: PatternObject): Pattern {
        const pattern = new Pattern()

        pattern.sequence = patternObject.sequence;
        pattern.deviationPercent = patternObject.deviationPercent;
        pattern.currentIndex = patternObject.currentIndex

        return pattern
    }
}