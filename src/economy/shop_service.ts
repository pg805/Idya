import fs from 'fs';
import { join } from 'path';
import prisma from '../database/prisma.js';
import type { ShopItemListing, ShopConfig } from './shop_loader.js';
import { loadShop } from './shop_loader.js';
import { clamp, currentR, logisticStep, xToMultiplier, effectiveMultiplier } from './shop_math.js';
import { ITEMS } from './items.js';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RECENT_VOLUME_DECAY = 0.7; // half-life ~2 days; ~8% remains after 7 days
const DESTOCK_THRESHOLD   = 0.75; // when stock >= this fraction of cap, tick dumps instead of restocks
const DESTOCK_MULTIPLIER  = 2;    // dump 2× the rolled Restock_Field value

export interface PricedItem extends ShopItemListing {
  buy?:          number;
  sell?:         number;
  current_stock: number;
}

function rollField(field: number[]): number {
  return field[Math.floor(Math.random() * field.length)];
}

async function getOrCreateState(shopKey: string, item: ShopItemListing) {
  return prisma.shopItemState.upsert({
    where:  { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
    update: {},
    create: {
      shop_id: shopKey,
      item_id: item.id,
      x:       0.5,
      stock:   Math.floor(item.stock_max / 2),
    },
  });
}

async function maybeTickDaily(shopKey: string, item: ShopItemListing, state: Awaited<ReturnType<typeof getOrCreateState>>) {
  if (Date.now() - state.last_tick.getTime() < TICK_INTERVAL_MS) return state;

  const newRecentVolume = Math.floor(state.recent_volume * RECENT_VOLUME_DECAY);
  const r      = currentR(item, newRecentVolume);
  const newX   = logisticStep(state.x, r);
  // Same Restock_Field roll runs every tick. When stock is at or above 75% of
  // cap the shop liquidates instead of restocking — dumps 2× the rolled value.
  // Without this items like venison sit at stock_max forever and nobody can
  // sell more (soft-lock).
  const roll = rollField(item.restock_field);
  const overstocked = item.stock_max > 0 && state.stock >= item.stock_max * DESTOCK_THRESHOLD;
  const stockDelta = overstocked ? -roll * DESTOCK_MULTIPLIER : roll;
  const newStock = Math.max(0, Math.min(state.stock + stockDelta, item.stock_max));

  // Optimistic lock — only one concurrent request runs the tick
  const updated = await prisma.shopItemState.updateMany({
    where: { shop_id: shopKey, item_id: item.id, last_tick: state.last_tick },
    data:  { x: newX, stock: newStock, recent_volume: newRecentVolume, last_tick: new Date() },
  });

  if (updated.count === 0) {
    // Another request already ticked — re-read fresh state
    return prisma.shopItemState.findUniqueOrThrow({
      where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
    });
  }

  return { ...state, x: newX, stock: newStock, recent_volume: newRecentVolume, last_tick: new Date() };
}


// Walk every shop yaml in shopDir, find any items whose last_tick is older
// than TICK_INTERVAL_MS, run maybeTickDaily on each. Called on a timer from
// the server so the world keeps ticking even when no player visits a shop.
// Returns the number of items that actually ticked, for logging.
export async function tickAllDue(shopDir: string): Promise<number> {
  let ticked = 0;
  for (const file of fs.readdirSync(shopDir)) {
    if (!file.endsWith('.yaml')) continue;
    const shopKey = file.replace(/\.yaml$/, '');
    let config: ShopConfig;
    try { config = loadShop(shopKey, shopDir); }
    catch { continue; }
    for (const item of config.items) {
      try {
        let state = await getOrCreateState(shopKey, item);
        if (Date.now() - state.last_tick.getTime() < TICK_INTERVAL_MS) continue;
        const before = state.last_tick;
        state = await maybeTickDaily(shopKey, item, state);
        if (state.last_tick.getTime() !== before.getTime()) ticked++;
      } catch (err) {
        console.error(`tickAllDue: ${shopKey}/${item.id} failed`, err);
      }
    }
  }
  return ticked;
}

export async function getPrices(shopKey: string, config: ShopConfig): Promise<PricedItem[]> {
  const results: PricedItem[] = [];

  for (const item of config.items) {
    let state = await getOrCreateState(shopKey, item);
    state = await maybeTickDaily(shopKey, item, state);

    const mult = effectiveMultiplier(item, state.x, state.stock);

    results.push({
      ...item,
      buy:           item.base_buy  != null ? Math.round(item.base_buy  * mult) : undefined,
      sell:          item.base_sell != null ? Math.round(item.base_sell * mult) : undefined,
      current_stock: state.stock,
    });
  }

  return results;
}

async function applyTransactionShock(shopKey: string, item: ShopItemListing, quantity: number, isBuy: boolean) {
  if (quantity < item.transaction_threshold) return;

  const state = await prisma.shopItemState.findUniqueOrThrow({
    where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
  });

  const r        = currentR(item, state.recent_volume);
  const direction = isBuy ? 1 : -1;
  const shockMag  = Math.min(quantity / item.transaction_threshold, 3) * 0.1;
  const shockedX  = clamp(state.x + direction * shockMag, 0, 1);
  const newX      = logisticStep(shockedX, r);

  await prisma.shopItemState.update({
    where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
    data:  { x: newX },
  });
}

export async function buyItem(
  shopKey: string,
  item: PricedItem,
  characterId: string,
  discordId: string,
  quantity: number,
): Promise<{ success: boolean; message: string }> {
  if (item.buy == null) return { success: false, message: 'Not for sale.' };

  if (!item.infinite) {
    const state = await prisma.shopItemState.findUniqueOrThrow({
      where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
    });
    if (state.stock < quantity) {
      return { success: false, message: `Only ${state.stock} in stock.` };
    }
  }

  const total = item.buy * quantity;

  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { discord_id: discordId } });
    if (!user || user.korel < total) {
      return { success: false, message: `Not enough korel — need ${total}, have ${user?.korel ?? 0}.` };
    }

    await tx.user.update({ where: { discord_id: discordId }, data: { korel: { decrement: total } } });
    await tx.item.upsert({
      where:  { id: item.id },
      update: {},
      create: { id: item.id, name: ITEMS[item.id]?.name ?? item.id, description: ITEMS[item.id]?.description ?? '' },
    });
    await tx.inventoryItem.upsert({
      where:  { character_id_item_id: { character_id: characterId, item_id: item.id } },
      update: { quantity: { increment: quantity } },
      create: { character_id: characterId, item_id: item.id, quantity },
    });
    const stockUpdate = item.infinite
      ? { cumulative_volume: { increment: quantity }, recent_volume: { increment: quantity } }
      : { stock: { decrement: quantity }, cumulative_volume: { increment: quantity }, recent_volume: { increment: quantity } };
    await tx.shopItemState.update({
      where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
      data:  stockUpdate,
    });
    await tx.shopTransaction.create({
      data: { shop_id: shopKey, item_id: item.id, type: 'buy', quantity, discord_id: discordId },
    });
    await tx.korelLedger.create({
      data: { discord_id: discordId, amount: -total, reason: 'shop_buy', note: `${quantity}× ${item.id} @ ${shopKey}` },
    });

    return { success: true, message: `Bought ${quantity}× for ${total} korel.` };
  });

  if (result.success) {
    await applyTransactionShock(shopKey, item, quantity, true);
  }
  return result;
}

export async function sellItem(
  shopKey: string,
  item: PricedItem,
  characterId: string,
  discordId: string,
  quantity: number,
): Promise<{ success: boolean; message: string }> {
  if (item.sell == null) return { success: false, message: "This shop doesn't buy that." };

  const state = await prisma.shopItemState.findUniqueOrThrow({
    where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
  });
  if (state.stock >= item.stock_max) {
    return { success: false, message: "The shop is fully stocked and isn't buying right now." };
  }
  const canTake = item.stock_max - state.stock;
  const actualQty = Math.min(quantity, canTake);
  const total = item.sell * actualQty;

  const result = await prisma.$transaction(async tx => {
    const inv = await tx.inventoryItem.findUnique({
      where: { character_id_item_id: { character_id: characterId, item_id: item.id } },
    });
    if (!inv || inv.quantity < quantity) {
      return { success: false, message: `You only have ${inv?.quantity ?? 0}.` };
    }

    if (inv.quantity === actualQty) {
      await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: characterId, item_id: item.id } } });
    } else {
      await tx.inventoryItem.update({
        where: { character_id_item_id: { character_id: characterId, item_id: item.id } },
        data:  { quantity: { decrement: actualQty } },
      });
    }

    await tx.user.update({ where: { discord_id: discordId }, data: { korel: { increment: total } } });
    await tx.shopItemState.update({
      where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
      data:  { stock: { increment: actualQty }, cumulative_volume: { increment: actualQty }, recent_volume: { increment: actualQty } },
    });
    await tx.shopTransaction.create({
      data: { shop_id: shopKey, item_id: item.id, type: 'sell', quantity: actualQty, discord_id: discordId },
    });
    await tx.korelLedger.create({
      data: { discord_id: discordId, amount: total, reason: 'shop_sell', note: `${actualQty}× ${item.id} @ ${shopKey}` },
    });

    const partialNote = actualQty < quantity ? ` (shop only had room for ${actualQty})` : '';
    return { success: true, message: `Sold ${actualQty}× for ${total} korel${partialNote}.` };
  });

  if (result.success) {
    await applyTransactionShock(shopKey, item, actualQty, false);
  }
  return result;
}
