import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { randomUUID } from 'crypto';
import Player_Character from './player_character.js';
import Weapon from '../weapon/weapon.js';

export interface CharacterData {
    id: string;
    discord_id: string;
    name: string;
    weapon: string;      // filename key, e.g. 'shovel', 'deck_of_cards'
    max_health: number;
    health: number;
    image: string;
}

const DEFAULT_IMAGE = 'https://cdn.discordapp.com/attachments/1258456865881194586/1341942313601204244/Asterius_with_Background_-_Big.png?ex=67b7d4ab&is=67b6832b&hm=e0f2f414fbf23dcca89969b37b6477e96049df1b142ea32feea0316e3f73c270&';

export default class CharacterRepository {
    private dir = './database/players';

    list(discord_id: string): CharacterData[] {
        const user_dir = path.join(this.dir, discord_id);
        if (!fs.existsSync(user_dir)) return [];
        return fs.readdirSync(user_dir)
            .filter(f => f.endsWith('.yaml'))
            .map(f => yaml.load(fs.readFileSync(path.join(user_dir, f), 'utf-8')) as CharacterData);
    }

    save(discord_id: string, data: CharacterData): void {
        const user_dir = path.join(this.dir, discord_id);
        if (!fs.existsSync(user_dir)) fs.mkdirSync(user_dir, { recursive: true });
        fs.writeFileSync(path.join(user_dir, `${data.id}.yaml`), yaml.dump(data), 'utf-8');
    }

    load(discord_id: string, character_id: string): CharacterData | null {
        const file = path.join(this.dir, discord_id, `${character_id}.yaml`);
        if (!fs.existsSync(file)) return null;
        return yaml.load(fs.readFileSync(file, 'utf-8')) as CharacterData;
    }

    create(discord_id: string, name: string, weapon_key: string): CharacterData {
        return {
            id: randomUUID(),
            discord_id,
            name,
            weapon: weapon_key,
            max_health: 50,
            health: 50,
            image: DEFAULT_IMAGE
        };
    }

    to_player_character(data: CharacterData): Player_Character {
        const weapon = Weapon.from_file(`./database/weapons/${data.weapon}.yaml`);
        return new Player_Character(data.name, data.health, weapon, data.image);
    }
}
