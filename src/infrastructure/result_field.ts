import Pattern from './pattern.js'

export default class Result_Field extends Pattern {

    constructor(field: Array<number>) {
        super(field)
    }

    get_result() {
        return this.field[Math.floor(Math.random() * this.length)];
    }
}