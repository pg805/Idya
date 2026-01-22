import Pattern from '../infrastructure/pattern.js';
import Weapon from '../weapon/weapon.js';
import Player_Character from './player_character.js';
import fs from 'fs';

export default class Non_Player_Character extends Player_Character {
    pattern: Pattern

    constructor(name: string, health: number, pattern: Pattern, weapon: Weapon, image: string) {
        super(name = name, health = health, weapon = weapon, image = image);
        this.pattern = pattern;
    }

    static from_file(file: string) {
        const npc_data: {
            'Name': string,
            'Health': number,
            'Pattern': Array<number>,
            'Image': string,
            'Weapon': {
                'Name': string,
                'Description': string,
                'Resource': { 'Name': string, 'Max': number },
                'Defend': [],
                'Defend Crit': [],
                'Attack': [],
                'Attack Crit': [],
                'Special': [],
                'Special Crit': []
            }
        } = JSON.parse(fs.readFileSync(file, 'utf-8'));

        return Non_Player_Character.from_json(npc_data)
    }

    static from_json(npc_data: {
        'Name': string,
        'Health': number,
        'Pattern': Array<number>,
        'Image': string,
        'Weapon': {
            'Name': string,
            'Description': string,
            'Resource': { 'Name': string, 'Max': number },
            'Defend': [],
            'Defend Crit': [],
            'Attack': [],
            'Attack Crit': [],
            'Special': [],
            'Special Crit': []
        }
    }) {
        
        const weapon = Weapon.from_json(npc_data['Weapon'])

        return new Non_Player_Character(
            npc_data['Name'],
            npc_data['Health'],
            new Pattern(npc_data['Pattern']),
            weapon,
            npc_data['Image']
        )
    }
}