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

    async create(discord_id: string, name: string, weapon_key: string, sprite_token?: string, nationality?: string, bio?: string): Promise<Character> {
        await prisma.user.upsert({
            where:  { discord_id },
            update: {},
            create: { discord_id }
        });

        const weapon = Weapon.from_file(`./database/weapons/${weapon_key}.yaml`);
        const hp = weapon.hp || 50;
        const character = await prisma.character.create({
            data: {
                discord_id,
                name,
                sprite_token:  sprite_token  ?? null,
                nationality:   nationality   ?? null,
                bio:           bio           ?? null,
                health:        hp,
                max_health:    hp,
            }
        });
        const starterWeapon = await prisma.characterWeapon.create({
            data: { character_id: character.id, weapon_key }
        });
        const updated = await prisma.character.update({
            where: { id: character.id },
            data:  { equipped_weapon_id: starterWeapon.id },
        });
        await prisma.eventLog.create({ data: {
            discord_id,
            event_type: 'character_created',
            payload: { name, weapon_key, sprite_token: sprite_token ?? null },
        }});
        return updated;
    }

    async to_player_character(data: Character): Promise<Player_Character> {
        const weaponKey = await this.equippedWeaponKey(data);
        const weapon = Weapon.from_file(`./database/weapons/${weaponKey}.yaml`);
        const image = data.sprite_token
            ? `${process.env.HOST_URL ?? 'http://localhost:3001'}/sprites/${data.sprite_token}.png`
            : '';
        return new Player_Character(data.name, data.health, weapon, image);
    }

    async equippedWeaponKey(data: Character): Promise<string> {
        if (!data.equipped_weapon_id) return 'branch';
        const w = await prisma.characterWeapon.findUnique({ where: { id: data.equipped_weapon_id } });
        return w?.weapon_key ?? 'branch';
    }
}
