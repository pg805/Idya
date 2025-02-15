import Action from '../action.js';

export default class Block extends Action {
    value: number
    type = 2
    type_name = 'BLOCK'

    constructor(name: string, value: number) {
        super(name);
        this.value = value;
    }
}
