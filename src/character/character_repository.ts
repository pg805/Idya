import prisma from '../database/prisma.js';
import Player_Character from './player_character.js';
import Weapon from '../weapon/weapon.js';
import { Character } from '@prisma/client';

export type { Character as CharacterData };

export default class CharacterRepository {

    async list(discord_id: string): Promise<Character[]> {
        return prisma.character.findMany({ where: { discord_id } });
    }

    async load(discord_id: string, character_id: string): Promise<Character | null> {
        return prisma.character.findFirst({ where: { id: character_id, discord_id } });
    }

    async create(discord_id: string, name: string, weapon_key: string, sprite_token?: string): Promise<Character> {
        await prisma.user.upsert({
            where:  { discord_id },
            update: {},
            create: { discord_id }
        });

        const character = await prisma.character.create({
            data: {
                discord_id,
                name,
                weapon_key,
                sprite_token: sprite_token ?? null,
                health:       50,
                max_health:   50,
            }
        });
        await prisma.characterWeapon.create({ data: { character_id: character.id, weapon_key } });
        return character;
    }

    to_player_character(data: Character): Player_Character {
        const weapon = Weapon.from_file(`./database/weapons/${data.weapon_key}.yaml`);
        const image = data.sprite_token
            ? `${process.env.HOST_URL ?? 'http://localhost:3001'}/sprites/${data.sprite_token}.png`
            : '';
        return new Player_Character(data.name, data.health, weapon, image);
    }
}
