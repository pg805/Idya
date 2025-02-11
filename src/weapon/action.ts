
export default class Action {
    name: string
    type: number = 0
    type_name: string = ''

    constructor(name: string) {
        this.name = name
    }
}