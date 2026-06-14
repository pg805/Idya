import logger from '../utility/logger.js';
import yaml from 'js-yaml';

import Result_Field from '../infrastructure/result_field.js';
import Action from './action.js';
import fs from 'fs';
import Block from './action/block.js';
import Buff from './action/buff.js';
import Damage_Over_Time from './action/damage_over_time.js';
import Debuff from './action/debuff.js';
import Heal from './action/heal.js';
import Strike from './action/strike.js';
import Reflect from './action/reflect.js';
import Shield from './action/shield.js';
import TileAction from './action/tile_action.js';
import DestroyObstacle from './action/destroy_obstacle.js';
import MoveDebuff from './action/move_debuff.js';

type ActionData = {
    'Name': string,
    'Action_String': string,
    'Type': number,
    'Type_Name': string,
    'Field': [],
    'Value': number,
    'Rounds': number,
    'Damage_Type'?: string,
    'Damage_Subtype'?: string,
    'Cost'?: number,
    'Range'?: number,
    'Area'?: number,
    'Push'?: number,
    'Smash'?: boolean,
    'MoveTo'?: boolean,
    'Aimed'?: boolean,
    'Targeted'?: boolean
}

function from_json(action_object: ActionData): Action {
    let action: Action;
    switch (action_object['Type']) {
        case 1:
            logger.info(`Adding Strike to Weapon: ${action_object['Name']}`);
            action = new Strike(action_object['Name'], action_object['Action_String'], new Result_Field(action_object['Field']));
            break;
        case 2:
            logger.info(`Adding Block to Weapon: ${action_object['Name']}`);
            action = new Block(action_object['Name'], action_object['Action_String'], action_object['Value']);
            break;
        case 3:
            logger.info(`Adding Buff to Weapon: ${action_object['Name']}`);
            action = new Buff(action_object['Name'], action_object['Action_String'], action_object['Value'], action_object['Rounds']);
            break;
        case 4:
            logger.info(`Adding Damage over Time to Weapon: ${action_object['Name']}`);
            action = new Damage_Over_Time(action_object['Name'], action_object['Action_String'], new Result_Field(action_object['Field']), action_object['Rounds']);
            break;
        case 5:
            logger.info(`Adding Debuff to Weapon: ${action_object['Name']}`);
            action = new Debuff(action_object['Name'], action_object['Action_String'], action_object['Value'], action_object['Rounds']);
            break;
        case 6:
            logger.info(`Adding Heal to Weapon: ${action_object['Name']}`);
            action = new Heal(action_object['Name'], action_object['Action_String'], action_object['Value']);
            break;
        case 7:
            logger.info(`Adding Reflect to Weapon: ${action_object['Name']}`);
            action = new Reflect(action_object['Name'], action_object['Action_String'], action_object['Value'], action_object['Rounds']);
            break;
        case 8:
            logger.info(`Adding Shield to Weapon: ${action_object['Name']}`);
            action = new Shield(action_object['Name'], action_object['Action_String'], action_object['Value'], action_object['Rounds']);
            break;
        case 9:
        case 10:
        case 11:
        case 13:
            logger.info(`Adding Tile (${action_object['Type']}) to Weapon: ${action_object['Name']}`);
            action = new TileAction(action_object['Name'], action_object['Action_String'], action_object['Type'], action_object['Value']);
            action.type_name = action_object['Type_Name'];
            break;
        case 12:
            logger.info(`Adding Destroy Obstacle to Weapon: ${action_object['Name']}`);
            action = new DestroyObstacle(action_object['Name'], action_object['Action_String'], new Result_Field(action_object['Field']));
            break;
        case 14:
            logger.info(`Adding Move Debuff to Weapon: ${action_object['Name']}`);
            action = new MoveDebuff(action_object['Name'], action_object['Action_String'], action_object['Value'], action_object['Rounds']);
            break;
        default:
            action = new Action('Error', 'Error');
    }
    action.damage_type    = action_object['Damage_Type']    ?? '';
    action.damage_subtype = action_object['Damage_Subtype'] ?? '';
    action.cost           = action_object['Cost']           ?? 0;
    action.range          = action_object['Range']          ?? 1;
    action.area           = action_object['Area']           ?? 1;
    action.push           = action_object['Push']           ?? 0;
    action.smash          = action_object['Smash']          ?? false;
    action.moveTo         = action_object['MoveTo']         ?? false;
    action.aimed          = action_object['Aimed']          ?? false;
    action.targeted       = action_object['Targeted']       ?? false;
    return action;
}

export default class Weapon {
    name: string
    description: string
    hp: number
    weight: number
    resource_name: string
    resource_max: number
    defend: Array<Action>
    defend_crit: Array<Action>
    attack: Array<Action>
    attack_crit: Array<Action>
    special: Array<Action>
    special_crit: Array<Action>

    constructor(name: string, description: string, hp: number, weight: number, resource_name: string, resource_max: number, defend: Array<Action>, defend_crit: Array<Action>, attack: Array<Action>, attack_crit: Array<Action>, special: Array<Action>, special_crit: Array<Action>) {
        this.name = name;
        this.description = description;
        this.hp = hp;
        this.weight = weight;
        this.resource_name = resource_name;
        this.resource_max = resource_max;
        this.defend = defend;
        this.defend_crit = defend_crit;
        this.attack = attack;
        this.attack_crit = attack_crit;
        this.special = special;
        this.special_crit = special_crit;
    }

    defend_name() {
        return this.defend.map((action: Action) => action.name).join('/')
    }

    attack_name() {
        return this.attack.map((action: Action) => action.name).join('/')
    }

    attack_crit_name() {
        return this.attack_crit.map((action: Action) => action.name).join('/')
    }

    special_name() {
        return this.special.map((action: Action) => action.name).join('/')
    }

    static from_file(file: string) {
        const weapon_data = yaml.load(fs.readFileSync(file, 'utf-8')) as {
            'Name': string,
            'Description': string,
            'HP': number,
            'Resource': { 'Name': string, 'Max': number },
            'Defend': [],
            'Defend Crit': [],
            'Attack': [],
            'Attack Crit': [],
            'Special': [],
            'Special Crit': []
        };

        return Weapon.from_json(weapon_data)
    }

    static from_json(weapon_data: {
            'Name': string,
            'Description': string,
            'HP'?: number,
            'Weight'?: number,
            'Resource': { 'Name': string, 'Max': number },
            'Defend': [],
            'Defend Crit': [],
            'Attack': [],
            'Attack Crit': [],
            'Special': [],
            'Special Crit': []
        }) {

        logger.info(`Loading Weapon: ${weapon_data['Name']}`);

        return new Weapon(
            weapon_data['Name'],
            weapon_data['Description'],
            weapon_data['HP']     ?? 0,
            weapon_data['Weight'] ?? 0,
            weapon_data['Resource']['Name'],
            weapon_data['Resource']['Max'],
            (weapon_data['Defend']        ?? []).flatMap((action_object: ActionData) => from_json(action_object)),
            (weapon_data['Defend Crit']   ?? []).flatMap((action_object: ActionData) => from_json(action_object)),
            (weapon_data['Attack']        ?? []).flatMap((action_object: ActionData) => from_json(action_object)),
            (weapon_data['Attack Crit']   ?? []).flatMap((action_object: ActionData) => from_json(action_object)),
            (weapon_data['Special']       ?? []).flatMap((action_object: ActionData) => from_json(action_object)),
            (weapon_data['Special Crit']  ?? []).flatMap((action_object: ActionData) => from_json(action_object)),
        );
    }
}
