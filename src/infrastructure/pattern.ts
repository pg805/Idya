export enum PatternActionType {
    None    = 0,
    Defend  = 1,
    Attack  = 2,
    Special = 3
}

export interface PatternEntry {
    type: PatternActionType;
    index: number;
}

export default class Pattern {
    length: number
    field: Array<PatternEntry>

    constructor(field: Array<[number, number]>) {
        this.field = field.map(([type, index]) => ({ type: type as PatternActionType, index }));
        this.length = field.length;
    }
}
