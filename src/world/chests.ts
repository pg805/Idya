import prisma from '../database/prisma.js';

/**
 * Containers standing in the world.
 *
 * A chest is a WorldObject with a chest sprite; its contents are ChestSlot rows.
 * Slots rather than a quantity map, because a chest is a grid somebody arranges
 * and where a stack sits is a decision they made — collapsing it to
 * "item -> count" would reshuffle their chest each time they opened it. That is
 * the difference from InventoryItem, which is a bag and has no order.
 *
 * Every write is a transaction. Two people can be standing at the same chest,
 * and a read-modify-write outside one loses whichever of them was slower.
 */

/** Two rows of six. */
export const CHEST_SLOTS = 12;
export const CHEST_COLS = 6;

export const isChestSprite = (sprite: string): boolean => /^obj_chest/.test(sprite);

export interface ChestSlotView {
  slot: number;
  itemId: string;
  name: string;
  quantity: number;
}

export interface ChestView {
  id: string;
  slots: ChestSlotView[];
  size: number;
  cols: number;
}

/** Everything in a chest, as the rows that exist. Empty slots are simply absent. */
export async function readChest(objectId: string): Promise<ChestView> {
  const rows = await prisma.chestSlot.findMany({
    where: { object_id: objectId },
    orderBy: { slot: 'asc' },
    include: { item: true },
  });
  return {
    id: objectId,
    size: CHEST_SLOTS,
    cols: CHEST_COLS,
    slots: rows.map(r => ({
      slot: r.slot, itemId: r.item_id, name: r.item.name, quantity: r.quantity,
    })),
  };
}

export type MoveResult = { ok: true } | { ok: false; why: string };

/**
 * Take from a chest slot into a character's bag.
 *
 * Quantity defaults to the whole stack, which is what a click on a slot means.
 */
export async function takeFromChest(args: {
  objectId: string; slot: number; characterId: string; quantity?: number;
}): Promise<MoveResult> {
  return prisma.$transaction(async tx => {
    const row = await tx.chestSlot.findUnique({
      where: { object_id_slot: { object_id: args.objectId, slot: args.slot } },
    });
    if (!row) return { ok: false, why: 'That slot is empty.' };

    const qty = Math.max(1, Math.min(args.quantity ?? row.quantity, row.quantity));

    if (qty >= row.quantity) {
      await tx.chestSlot.delete({
        where: { object_id_slot: { object_id: args.objectId, slot: args.slot } },
      });
    } else {
      await tx.chestSlot.update({
        where: { object_id_slot: { object_id: args.objectId, slot: args.slot } },
        data: { quantity: row.quantity - qty },
      });
    }

    await tx.inventoryItem.upsert({
      where: { character_id_item_id: { character_id: args.characterId, item_id: row.item_id } },
      update: { quantity: { increment: qty } },
      create: { character_id: args.characterId, item_id: row.item_id, quantity: qty },
    });
    return { ok: true };
  });
}

/**
 * Put from a character's bag into a chest.
 *
 * A slot may be named; otherwise it stacks onto the same item if it is already
 * in there and falls back to the first free slot. Stacking first is what makes
 * depositing twice feel like one action rather than two.
 */
export async function putInChest(args: {
  objectId: string; itemId: string; characterId: string;
  quantity?: number; slot?: number;
}): Promise<MoveResult> {
  return prisma.$transaction(async tx => {
    const held = await tx.inventoryItem.findUnique({
      where: { character_id_item_id: { character_id: args.characterId, item_id: args.itemId } },
    });
    if (!held || held.quantity <= 0) return { ok: false, why: 'You are not carrying that.' };

    const qty = Math.max(1, Math.min(args.quantity ?? held.quantity, held.quantity));

    const rows = await tx.chestSlot.findMany({ where: { object_id: args.objectId } });
    const used = new Map(rows.map(r => [r.slot, r]));

    let target = args.slot;
    if (target === undefined) {
      const stack = rows.find(r => r.item_id === args.itemId);
      if (stack) target = stack.slot;
      else {
        for (let i = 0; i < CHEST_SLOTS; i++) if (!used.has(i)) { target = i; break; }
      }
    }
    if (target === undefined) return { ok: false, why: 'The chest is full.' };
    if (target < 0 || target >= CHEST_SLOTS) return { ok: false, why: 'No such slot.' };

    const at = used.get(target);
    if (at && at.item_id !== args.itemId) return { ok: false, why: 'Something else is in that slot.' };

    if (held.quantity <= qty) {
      await tx.inventoryItem.delete({
        where: { character_id_item_id: { character_id: args.characterId, item_id: args.itemId } },
      });
    } else {
      await tx.inventoryItem.update({
        where: { character_id_item_id: { character_id: args.characterId, item_id: args.itemId } },
        data: { quantity: held.quantity - qty },
      });
    }

    await tx.chestSlot.upsert({
      where: { object_id_slot: { object_id: args.objectId, slot: target } },
      update: { quantity: { increment: qty } },
      create: { object_id: args.objectId, slot: target, item_id: args.itemId, quantity: qty },
    });
    return { ok: true };
  });
}
