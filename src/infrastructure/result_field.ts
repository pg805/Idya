import { RollMode } from './roll_mode.js';

export default class Result_Field {
    field: Array<number>
    length: number

    constructor(field: Array<number>) {
        this.field = field;
        this.length = field.length;
    }

    get_result() {
        return this.field[Math.floor(Math.random() * this.length)];
    }

    get_result_with_mode(mode: RollMode): number {
        const pick = () => this.field[Math.floor(Math.random() * this.length)];

        switch (mode) {
            case RollMode.Ld2: {
                return Math.min(pick(), pick());
            }
            case RollMode.Hd2: {
                return Math.max(pick(), pick());
            }
            case RollMode.Hd4: {
                return Math.max(pick(), pick(), pick(), pick());
            }
            case RollMode.One:
            default:
                return pick();
        }
    }
}
