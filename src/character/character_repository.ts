import prisma from '../database/prisma.js';
import Player_Character from './player_character.js';
import Weapon from '../weapon/weapon.js';
import { Character } from '@prisma/client';

export type { Character as CharacterData };

const DEFAULT_IMAGE = 'https://cdn.discordapp.com/attachments/1258456865881194586/1341942313601204244/Asterius_with_Background_-_Big.png?ex=67b7d4ab&is=67b6832b&hm=e0f2f414fbf23dcca89969b37b6477e96049df1b142ea32feea0316e3f73c270&';

export default class CharacterRepository {

    async list(discord_id: string): Promise<Character[]> {
        return prisma.character.findMany({ where: { discord_id } });
    }

    async load(discord_id: string, character_id: string): Promise<Character | null> {
        return prisma.character.findFirst({ where: { id: character_id, discord_id } });
    }

    async create(discord_id: string, name: string, weapon_key: string): Promise<Character> {
        await prisma.user.upsert({
            where:  { discord_id },
            update: {},
            create: { discord_id }
        });

        return prisma.character.create({
            data: {
                discord_id,
                name,
                weapon_key,
                health:     50,
                max_health: 50,
                image:      DEFAULT_IMAGE
            }
        });
    }

    to_player_character(data: Character): Player_Character {
        const weapon = Weapon.from_file(`./database/weapons/${data.weapon_key}.yaml`);
        return new Player_Character(data.name, data.health, weapon, data.image);
    }
}
