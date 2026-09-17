import prisma from '../database/prisma.js';
import Player_Character from './player_character.js';
import Weapon from '../weapon/weapon.js';
import { Character } from '@prisma/client';

export type { Character as CharacterData };

// Where a new character wakes up: the gap in the ring of logs around the
// campfire at the south-east of Sulku'it (the fire is at 19,20 and the logs
// close it on three sides, leaving the south open). Arriving at a lit fire
// with somewhere to sit reads as being met, which the middle of an empty
// field does not. The schema default of 12,12 stays as the fallback for rows
// written by anything that does not go through here.
const SPAWN = { x: 19, y: 21 } as const;

export default class CharacterRepository {

    async list(discord_id: string): Promise<Character[]> {
        return prisma.character.findMany({ where: { discord_id } });
    }

    async load(discord_id: string, character_id: string): Promise<Character | null> {
        return prisma.character.findFirst({ where: { id: character_id, discord_id } });
    }
    /**
     * `sheet` is everything on the character sheet beyond a name and a sprite.
     * All of it is optional by design: a name and a sprite put you on the map,
     * and the rest is what turns a provisional character into a canon one
     * (docs/world.md section 11). Goals arrive as chosen (kind, variant) pairs
     * already validated by the caller.
     */
    async create(
        discord_id: string,
        name: string,
        weapon_key: string,
        sprite_token?: string,
        nationality?: string,
        bio?: string,
        sheet?: {
            physical?: string;
            relationships?: string;
            forceStances?: Record<string, string>;
            goals?: { kind: string; variant?: string | null; detail?: string | null; status: string }[];
        },
    ): Promise<Character> {
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
                physical:      sheet?.physical      ?? null,
                relationships: sheet?.relationships ?? null,
                force_stances: (sheet?.forceStances ?? {}) as object,
                health:        hp,
                max_health:    hp,
                tile_x:        SPAWN.x,
                tile_y:        SPAWN.y,
            }
        });
        if (sheet?.goals?.length) {
            await prisma.characterGoal.createMany({
                data: sheet.goals.map(g => ({
                    character_id: character.id,
                    kind:    g.kind,
                    variant: g.variant ?? null,
                    detail:  g.detail  ?? null,
                    status:  g.status,
                })),
            });
        }
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
