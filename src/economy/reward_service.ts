import prisma from '../database/prisma.js';
import { ITEMS } from './items.js';

export type LootEntry = { id: string; chance: number; min: number; max: number };
export type LootTable = { currency: [number, number]; items: LootEntry[] };

export type RewardResult = {
    currency: number;
    items: Array<{ name: string; quantity: number }>;
    summary: string;
};

function rand_int(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default class RewardService {
    async grant(discord_id: string, character_id: string, loot_table: LootTable): Promise<RewardResult> {
        const currency = rand_int(loot_table.currency[0], loot_table.currency[1]);

        const dropped: Array<{ id: string; name: string; quantity: number }> = [];
        for (const entry of loot_table.items) {
            if (Math.random() < entry.chance) {
                const quantity = rand_int(entry.min, entry.max);
                dropped.push({ id: entry.id, name: ITEMS[entry.id]?.name ?? entry.id, quantity });
            }
        }

        await prisma.user.update({
            where: { discord_id },
            data:  { currency: { increment: currency } }
        });

        for (const item of dropped) {
            await prisma.item.upsert({
                where:  { id: item.id },
                update: {},
                create: { id: item.id, name: ITEMS[item.id]?.name ?? item.id, description: ITEMS[item.id]?.description ?? '' }
            });
            await prisma.inventoryItem.upsert({
                where:  { character_id_item_id: { character_id, item_id: item.id } },
                update: { quantity: { increment: item.quantity } },
                create: { character_id, item_id: item.id, quantity: item.quantity }
            });
        }

        const lines = [`+${currency} currency`, ...dropped.map(i => `+${i.quantity}x ${i.name}`)];
        const summary = lines.join('\n');

        return { currency, items: dropped.map(({ name, quantity }) => ({ name, quantity })), summary };
    }
}
