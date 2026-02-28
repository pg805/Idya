import Pattern from '../infrastructure/pattern.js';
import Weapon from '../weapon/weapon.js';
import Player_Character from './player_character.js';
import { Stance } from '../infrastructure/stance.js';
import fs from 'fs';
import yaml from 'js-yaml';

type NpcData = {
    'Name': string,
    'Health': number,
    'Pattern': Array<[number, number]>,
    'Stance_Pattern'?: Array<Stance>,
    'Image': string,
    'Resistances'?: Record<string, number>,
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
}

export default class Non_Player_Character extends Player_Character {
    pattern: Pattern
    stance_pattern: Array<Stance>
    resistances: Record<string, number>

    constructor(name: string, health: number, pattern: Pattern, stance_pattern: Array<Stance>, weapon: Weapon, image: string, resistances: Record<string, number> = {}) {
        super(name = name, health = health, weapon = weapon, image = image);
        this.pattern = pattern;
        this.stance_pattern = stance_pattern;
        this.resistances = resistances;
    }

    static from_file(file: string) {
        const npc_data = yaml.load(fs.readFileSync(file, 'utf-8')) as NpcData;
        return Non_Player_Character.from_json(npc_data)
    }

    static from_json(npc_data: NpcData) {
        const weapon = Weapon.from_json(npc_data['Weapon'])

        return new Non_Player_Character(
            npc_data['Name'],
            npc_data['Health'],
            new Pattern(npc_data['Pattern']),
            npc_data['Stance_Pattern'] ?? [Stance.Balanced],
            weapon,
            npc_data['Image'],
            npc_data['Resistances'] ?? {}
        )
    }
}