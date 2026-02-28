export interface PatternEntry {
    type: number;
    index: number;
}

export default class Pattern {
    length: number
    field: Array<PatternEntry>

    constructor(field: Array<[number, number]>) {
        this.field = field.map(([type, index]) => ({ type, index }));
        this.length = field.length;
    }
}
