import prisma from '../database/prisma.js';
import { isUnlock } from '../economy/items.js';

/**
 * Containers standing in the world.
 *
 * A chest is a WorldObject with a chest sprite; its contents are ChestSlot rows.
 * Slots rather than a quantity map, because a chest is a grid somebody arranges
 * and where a stack sits is a decision they made — collapsing it to
 * "item -> count" would reshuffle their chest each time they opened it. That is
 * the difference from InventoryItem, which is a bag and has no order.
 *
 * CONCURRENCY. Two people can stand at the same chest, and a transaction alone
 * does not save you: Postgres defaults to READ COMMITTED, so both can read
 * "quantity 5", both decide to take 5, and both credit themselves 5. That is a
 * transaction doing exactly what it promised and still duplicating items.
 *
 * So nothing here trusts a value it read. Every move is a CONDITIONAL write —
 * `updateMany` with the quantity it expects in the WHERE clause — and a count of
 * zero means somebody got there first, which aborts rather than proceeding on a
 * stale number. Reads are only ever used to work out WHAT to move; the database
 * decides whether the move is still legal.
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

    // Conditional: the row must STILL hold at least what we are taking. Zero
    // rows means somebody emptied or reduced it between the read and here, and
    // proceeding would credit items that no longer exist.
    const took = await tx.chestSlot.updateMany({
      where: { object_id: args.objectId, slot: args.slot, quantity: { gte: qty } },
      data: { quantity: { decrement: qty } },
    });
    if (took.count === 0) return { ok: false, why: 'Somebody got there first.' };

    // An emptied slot stops existing, which is what "no row means empty" means.
    await tx.chestSlot.deleteMany({
      where: { object_id: args.objectId, slot: args.slot, quantity: { lte: 0 } },
    });

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
  // Unlocks are identity, not goods. A trophy is proof you did a thing, one per
  // character ever, and the server has two boot passes that assume exactly
  // that: one re-grants a trophy whose inventory row is missing, the other
  // clamps any unlock above one back down. A chest holding trophies fights both
  // — storing one duplicates it on the next restart, and taking two out gets
  // one destroyed. It is not a storage problem, so it is refused here.
  if (isUnlock(args.itemId)) {
    return { ok: false, why: 'That is yours alone. It will not go in a chest.' };
  }
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

    // Same guard on the way out of the bag: you must still be carrying it.
    const paid = await tx.inventoryItem.updateMany({
      where: { character_id: args.characterId, item_id: args.itemId, quantity: { gte: qty } },
      data: { quantity: { decrement: qty } },
    });
    if (paid.count === 0) return { ok: false, why: 'You are not carrying that any more.' };
    await tx.inventoryItem.deleteMany({
      where: { character_id: args.characterId, item_id: args.itemId, quantity: { lte: 0 } },
    });

    // Add to the stack if that slot still holds this item; otherwise claim it.
    // A create that collides on the primary key throws, which rolls the whole
    // transaction back — including the bag decrement above — so a race costs a
    // retry rather than an item. Upserting here instead would have merged a
    // deposit into whatever somebody else had just put in the slot.
    const stacked = await tx.chestSlot.updateMany({
      where: { object_id: args.objectId, slot: target, item_id: args.itemId },
      data: { quantity: { increment: qty } },
    });
    if (stacked.count === 0) {
      await tx.chestSlot.create({
        data: { object_id: args.objectId, slot: target, item_id: args.itemId, quantity: qty },
      });
    }
    return { ok: true };
  });
}
