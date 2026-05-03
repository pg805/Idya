import prisma from '../database/prisma.js';
import { ITEMS } from './items.js';

export type LootEntry = { id: string; type: string; field: number[] };
export type LootTable = { currency?: number[]; items: LootEntry[] };

export type RewardResult = {
    currency: number;
    items: Array<{ name: string; quantity: number }>;
    summary: string;
};

function roll_field(field: number[]): number {
    return field[Math.floor(Math.random() * field.length)];
}

export default class RewardService {
    async grant(discord_id: string, character_id: string, loot_table: LootTable): Promise<RewardResult> {
        const currency = loot_table.currency ? roll_field(loot_table.currency) : 0;

        const dropped: Array<{ id: string; name: string; quantity: number }> = [];
        for (const entry of loot_table.items) {
            const quantity = roll_field(entry.field);
            if (quantity > 0) {
                dropped.push({ id: entry.id, name: ITEMS[entry.id]?.name ?? entry.id, quantity });
            }
        }

        if (currency > 0) {
            await prisma.user.update({
                where: { discord_id },
                data:  { korel: { increment: currency } }
            });
        }

        for (const item of dropped) {
            await prisma.item.upsert({
                where:  { id: item.id },
                update: {},
                create: {
                    id:          item.id,
                    name:        ITEMS[item.id]?.name        ?? item.id,
                    description: ITEMS[item.id]?.description ?? ''
                }
            });
            await prisma.inventoryItem.upsert({
                where:  { character_id_item_id: { character_id, item_id: item.id } },
                update: { quantity: { increment: item.quantity } },
                create: { character_id, item_id: item.id, quantity: item.quantity }
            });
        }

        const lines = [
            ...(currency > 0 ? [`+${currency} Korel`] : []),
            ...dropped.map(i => `+${i.quantity}x ${i.name}`)
        ];
        const summary = lines.length > 0 ? lines.join('\n') : 'No drops.';

        return { currency, items: dropped.map(({ name, quantity }) => ({ name, quantity })), summary };
    }
}
