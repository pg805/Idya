import Action from '../action.js';

export default class Heal extends Action {
    value: number
    type = 6
    type_name = 'HEAL'

    constructor(name: string, value: number) {
        super(name);
        this.value = value;
    }
}
