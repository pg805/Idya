import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import prisma from '../database/prisma.js';
import type { ShopItemListing, ShopConfig } from './shop_loader.js';
import { loadShop } from './shop_loader.js';
import { clamp, currentR, logisticStep, xToMultiplier, effectiveMultiplier } from './shop_math.js';
import { buildPricingContext, type PricingContext, type Side } from './price_resolver.js';
import { ITEMS } from './items.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Default search paths so callers don't have to thread directories through —
// the only places we call from are the running server (lib/) and the cli
// test harness, both of which use the same layout.
const SHOPS_DIR_DEFAULT   = join(__dirname, '../../database/shops');
const RECIPES_DIR_DEFAULT = join(__dirname, '../../database/recipes');

// Selling a crafted item only partly counts toward ingredient demand —
// the shop now stocks the crafted form, not the inputs. 0.5× felt right
// for "still involves the materials" without making sell-side dominate.
const INGREDIENT_PROPAGATION_BUY  = 1.0;
const INGREDIENT_PROPAGATION_SELL = 0.5;

const TICK_INTERVAL_MS    = 24 * 60 * 60 * 1000;
const DESTOCK_INTERVAL_MS = 60 * 60 * 1000;  // hourly overflow flush, decoupled from daily price tick
const RECENT_VOLUME_DECAY = 0.7; // half-life ~2 days; ~8% remains after 7 days
const DESTOCK_THRESHOLD   = 0.75; // when stock >= this fraction of cap, hourly tick dumps stock
const DESTOCK_MULTIPLIER  = 6;    // dump 6× the rolled Restock_Field value — keep stock flowing so players can always sell

// In-memory gate so the hourly destock doesn't fire more than once per hour per
// item. Lost on server restart — that's fine, worst case the next hourly walk
// catches up on anything that's overstocked.
const lastDestockAt = new Map<string, number>();

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

  // recent_volume is BigInt in the schema (to avoid INT4 overflow); coerce to
  // Number for the decay math. Realistic values stay far below MAX_SAFE_INTEGER.
  const newRecentVolume = Math.floor(Number(state.recent_volume) * RECENT_VOLUME_DECAY);
  const r      = currentR(item, newRecentVolume);
  const newX   = logisticStep(state.x, r);
  // Daily tick handles price/restock only. Destock is now on its own hourly
  // clock (see maybeHourlyDestock) so overstocked items don't sit pinned at
  // cap for up to 24 hours waiting for the next price tick.
  const roll = rollField(item.restock_field);
  const overstocked = item.stock_max > 0 && state.stock >= item.stock_max * DESTOCK_THRESHOLD;
  const stockDelta = overstocked ? 0 : roll;
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

  return { ...state, x: newX, stock: newStock, recent_volume: BigInt(newRecentVolume), last_tick: new Date() };
}

async function maybeHourlyDestock(shopKey: string, item: ShopItemListing, state: Awaited<ReturnType<typeof getOrCreateState>>) {
  if (item.stock_max <= 0) return state;
  if (state.stock < item.stock_max * DESTOCK_THRESHOLD) return state;

  const key = `${shopKey}:${item.id}`;
  const last = lastDestockAt.get(key) ?? 0;
  if (Date.now() - last < DESTOCK_INTERVAL_MS) return state;

  const roll = rollField(item.restock_field);
  const newStock = Math.max(0, state.stock - roll * DESTOCK_MULTIPLIER);

  await prisma.shopItemState.update({
    where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
    data:  { stock: newStock },
  });
  lastDestockAt.set(key, Date.now());
  return { ...state, stock: newStock };
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
        const beforeStock = state.stock;
        state = await maybeHourlyDestock(shopKey, item, state);
        if (Date.now() - state.last_tick.getTime() >= TICK_INTERVAL_MS) {
          const before = state.last_tick;
          state = await maybeTickDaily(shopKey, item, state);
          if (state.last_tick.getTime() !== before.getTime()) ticked++;
        }
        if (state.stock !== beforeStock) ticked++;
      } catch (err) {
        console.error(`tickAllDue: ${shopKey}/${item.id} failed`, err);
      }
    }
  }
  return ticked;
}

export async function getPrices(shopKey: string, config: ShopConfig): Promise<PricedItem[]> {
  // First pass: make sure every item in this shop is ticked/destocked so the
  // resolver reads up-to-date x/stock state. Cross-shop ingredient lookups
  // hit whatever state those items have — they get their own tick when
  // someone visits that shop (or via the background tickAllDue sweep).
  for (const item of config.items) {
    let state = await getOrCreateState(shopKey, item);
    state = await maybeHourlyDestock(shopKey, item, state);
    await maybeTickDaily(shopKey, item, state);
  }

  // One pricing context per request — the resolver memoizes inside it so
  // shared ingredients (thuvel showing up in four recipes) only get priced
  // once.
  const ctx = buildPricingContext(SHOPS_DIR_DEFAULT, RECIPES_DIR_DEFAULT);
  const results: PricedItem[] = [];

  for (const item of config.items) {
    const state = await prisma.shopItemState.findUniqueOrThrow({
      where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
    });
    const [buyPrice, sellPrice] = await Promise.all([
      ctx.currentPrice(item.id, 'buy'),
      ctx.currentPrice(item.id, 'sell'),
    ]);

    results.push({
      ...item,
      buy:           buyPrice  == null ? undefined : Math.round(buyPrice),
      sell:          sellPrice == null ? undefined : Math.round(sellPrice),
      current_stock: state.stock,
    });
  }

  return results;
}

// When a crafted item changes hands, the implicit demand for its components
// flows through to their recent_volume. Buying hiruos pulls thuvel demand
// up (full effect); selling hiruos back to the shop nudges thuvel demand
// up half as hard (the shop now stocks hiruos, not raw thuvel, so the
// ingredient market only partly cares).
async function propagateToIngredients(
  itemId: string,
  quantity: number,
  side: Side,
  ctx: PricingContext,
) {
  const recipe = ctx.recipeFor(itemId);
  if (!recipe) return;
  const factor = side === 'buy' ? INGREDIENT_PROPAGATION_BUY : INGREDIENT_PROPAGATION_SELL;
  for (const ingr of recipe.ingredients) {
    const ingrId = ingr.item_id ?? ingr.weapon_id;
    if (!ingrId) continue;
    const ingrShop = ctx.shopOf(ingrId);
    if (!ingrShop) continue;
    const bump = Math.round(quantity * ingr.quantity * factor);
    if (bump <= 0) continue;
    await prisma.shopItemState.update({
      where: { shop_id_item_id: { shop_id: ingrShop.shopKey, item_id: ingrId } },
      data:  { recent_volume: { increment: BigInt(bump) } },
    }).catch(() => {}); // missing ShopItemState shouldn't break the parent transaction
    // Recurse: if the ingredient is itself crafted (e.g., a tier-3 recipe
    // taking tier-2 outputs), its components feel the pull too. Bounded by
    // the recipe DAG so this terminates.
    await propagateToIngredients(ingrId, quantity * ingr.quantity, side, ctx);
  }
}

async function applyTransactionShock(shopKey: string, item: ShopItemListing, quantity: number, isBuy: boolean) {
  if (quantity < item.transaction_threshold) return;

  const state = await prisma.shopItemState.findUniqueOrThrow({
    where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
  });

  const r        = currentR(item, Number(state.recent_volume));
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
    const ctx = buildPricingContext(SHOPS_DIR_DEFAULT, RECIPES_DIR_DEFAULT);
    await propagateToIngredients(item.id, quantity, 'buy', ctx);
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
    const ctx = buildPricingContext(SHOPS_DIR_DEFAULT, RECIPES_DIR_DEFAULT);
    await propagateToIngredients(item.id, actualQty, 'sell', ctx);
  }
  return result;
}
