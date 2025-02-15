export default class Pattern {
    length: number
    field: Array<number>

    constructor(field: Array<number>) {
        this.field = field;
        this.length = field.length;
    }
}
