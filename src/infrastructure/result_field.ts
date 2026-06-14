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
        return this.roll_detail(mode).result;
    }

    // Roll the field under a mode, returning the result AND which die-face indices
    // were rolled (so the log can bold them in place). 1d rolls one die; Hd2/Hd4
    // roll 2/4 and take the highest; Ld2 rolls 2 and takes the lowest.
    roll_detail(mode: RollMode): { result: number; indices: number[] } {
        const pick = () => Math.floor(Math.random() * this.length);
        let indices: number[];
        switch (mode) {
            case RollMode.Ld2: indices = [pick(), pick()]; break;
            case RollMode.Hd2: indices = [pick(), pick()]; break;
            case RollMode.Hd4: indices = [pick(), pick(), pick(), pick()]; break;
            case RollMode.One:
            default:           indices = [pick()]; break;
        }
        const vals = indices.map(i => this.field[i]);
        const result = mode === RollMode.Ld2 ? Math.min(...vals) : Math.max(...vals);
        return { result, indices };
    }
}
