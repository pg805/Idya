import Result_Field from "../infrastructure/result_field.js"
import Action from "./action.js"
import fs from 'fs'
import Block from "./action/block.js"
import Buff from "./action/buff.js"
import Damage_Over_Time from "./action/damage_over_time.js"
import Debuff from "./action/debuff.js"
import Heal from "./action/heal.js"
import Strike from "./action/strike.js"
import Reflect from "./action/reflect.js"
import Shield from "./action/shield.js"

function from_json(action_object: {
    "Name": string,
    "Type": number,
    "Type_Name": string,
    "Field": [],
    "Value": number,
    "Rounds": number
}) {
    switch(action_object['Type']) {
        case 1:
            console.log(`Adding Strike to Weapon: ${action_object['Name']}`)
            return new Strike(action_object['Name'], new Result_Field(action_object['Field']))
        case 2:
            console.log(`Adding Block to Weapon: ${action_object['Name']}`)
            return new Block(action_object['Name'], action_object['Value'])
        case 3:
            console.log(`Adding Buff to Weapon: ${action_object['Name']}`)
            return new Buff(action_object['Name'], action_object['Value'], action_object['Rounds'])
        case 4:
            console.log(`Adding Damage over Time to Weapon: ${action_object['Name']}`)
            return new Damage_Over_Time(action_object['Name'], new Result_Field(action_object['Field']), action_object['Rounds'])
        case 5:
            console.log(`Adding Debuff to Weapon: ${action_object['Name']}`)
            return new Debuff(action_object['Name'], action_object['Value'], action_object['Rounds'])
        case 6:
            console.log(`Adding Heal to Weapon: ${action_object['Name']}`)
            return new Heal(action_object['Name'], action_object['Value'])
        case 7:
            console.log(`Adding Reflect to Weapon: ${action_object['Name']}`)
            return new Reflect(action_object['Name'], action_object['Value'], action_object['Rounds'])
        case 8:
            console.log(`Adding Shield to Weapon: ${action_object['Name']}`)
            return new Shield(action_object['Name'], action_object['Value'], action_object['Rounds'])
        default:
            return new Action('Error')
    }
}

export default class Weapon {
    name: string
    defend: Array<Action>
    defend_crit: Array<Action>
    attack: Array<Action>
    attack_crit: Array<Action>
    special: Array<Action>
    special_crit: Array<Action>

    constructor(name: string, defend: Array<Action>, defend_crit: Array<Action>, attack: Array<Action>, attack_crit: Array<Action>, special: Array<Action>, special_crit: Array<Action>) {
        this.name = name
        this.defend = defend
        this.defend_crit = defend_crit
        this.attack = attack
        this.attack_crit = attack_crit
        this.special = special
        this.special_crit = special_crit
    }

    static from_json(file: string) {
        const weapon_data: { 
            "Name": string, 
            "Defend": [],
            "Defend Crit": [],
            "Attack": [],
            "Attack Crit": [],
            "Special": [],
            "Special Crit": []
        } = JSON.parse(fs.readFileSync(file, 'utf-8'))

        console.log(`Loading Weapon: ${weapon_data['Name']}`)

        return new Weapon(
            weapon_data['Name'], 
            weapon_data['Defend'].flatMap((action_object: {
                "Name": string,
                "Type": number,
                "Type_Name": string,
                "Field": [],
                "Value": number,
                "Rounds": number
            }) => from_json(action_object)),
            weapon_data['Defend Crit'].flatMap((action_object: {
                "Name": string,
                "Type": number,
                "Type_Name": string,
                "Field": [],
                "Value": number,
                "Rounds": number
            }) => from_json(action_object)),
            weapon_data['Attack'].flatMap((action_object: {
                "Name": string,
                "Type": number,
                "Type_Name": string,
                "Field": [],
                "Value": number,
                "Rounds": number
            }) => from_json(action_object)),
            weapon_data['Attack Crit'].flatMap((action_object: {
                "Name": string,
                "Type": number,
                "Type_Name": string,
                "Field": [],
                "Value": number,
                "Rounds": number
            }) => from_json(action_object)),
            weapon_data['Special'].flatMap((action_object: {
                "Name": string,
                "Type": number,
                "Type_Name": string,
                "Field": [],
                "Value": number,
                "Rounds": number
            }) => from_json(action_object)),
            weapon_data['Special Crit'].flatMap((action_object: {
                "Name": string,
                "Type": number,
                "Type_Name": string,
                "Field": [],
                "Value": number,
                "Rounds": number
            }) => from_json(action_object)),
        )
    }
}
