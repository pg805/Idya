// Recipe-driven pricing for crafted items.
//
// For every item sold at a shop:
//   - Raw (no recipe)  → price = base × R_mult  (same as before)
//   - Crafted (recipe) → price = Σ(ingr.price × qty) × margin × R_mult
//
// margin_buy / margin_sell live on the recipe (default 1.1). Cross-shop
// lookups are intentional — a kustaff crafted from a quarterstaff
// (lumberjack) + hiruos (enchanter) needs both lookups. The resolver
// memoizes per request so the same ingredient isn't priced twice.
//
// Cycle guard exists in case a recipe ever closes a loop; in practice
// recipes form a DAG.

import fs from 'fs';
import prisma from '../database/prisma.js';
import { loadShop, type ShopItemListing } from './shop_loader.js';
import { loadAllRecipes, type Recipe } from './recipe_loader.js';
import { effectiveMultiplier } from './shop_math.js';

export type Side = 'buy' | 'sell';

export interface PricingContext {
  currentPrice(itemId: string, side: Side): Promise<number | null>;
  recipeFor(itemId: string): Recipe | undefined;
  shopOf(itemId: string): { shopKey: string; listing: ShopItemListing } | undefined;
}

export function buildPricingContext(shopsDir: string, recipesDir: string): PricingContext {
  // item_id → (shopKey, listing). First-wins on collisions (most items live
  // in exactly one shop; collisions are unusual).
  const itemIndex = new Map<string, { shopKey: string; listing: ShopItemListing }>();
  for (const file of fs.readdirSync(shopsDir).filter(f => f.endsWith('.yaml'))) {
    const shopKey = file.replace(/\.yaml$/, '');
    let config;
    try { config = loadShop(shopKey, shopsDir); }
    catch { continue; }
    for (const listing of config.items) {
      if (!itemIndex.has(listing.id)) itemIndex.set(listing.id, { shopKey, listing });
    }
  }

  // output_id → recipe. Only item/weapon outputs get indexed; enchant recipes
  // don't produce a tradeable item.
  const craftedIndex = new Map<string, Recipe>();
  for (const recipe of loadAllRecipes(recipesDir)) {
    if (recipe.output.type === 'enchant') continue;
    if (!recipe.output.id) continue;
    if (!craftedIndex.has(recipe.output.id)) craftedIndex.set(recipe.output.id, recipe);
  }

  const memo = new Map<string, number | null>();

  async function currentPrice(itemId: string, side: Side, visited = new Set<string>()): Promise<number | null> {
    const key = `${itemId}:${side}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    if (visited.has(itemId)) return null; // cycle guard — shouldn't fire in practice
    visited.add(itemId);

    const entry = itemIndex.get(itemId);
    if (!entry) { memo.set(key, null); visited.delete(itemId); return null; }

    const state = await prisma.shopItemState.findUnique({
      where: { shop_id_item_id: { shop_id: entry.shopKey, item_id: itemId } },
    });
    // No state yet means the item has never been touched at this shop; treat
    // mult as neutral (1.0) so an unvisited item still produces a sensible
    // price the first time it's queried.
    const mult = state
      ? effectiveMultiplier(entry.listing, state.x, state.stock)
      : 1.0;

    const recipe = craftedIndex.get(itemId);

    let price: number | null;
    if (recipe) {
      let inputCost = 0;
      for (const ingr of recipe.ingredients) {
        const ingrId = ingr.item_id ?? ingr.weapon_id;
        if (!ingrId) { memo.set(key, null); visited.delete(itemId); return null; }
        const ingrPrice = await currentPrice(ingrId, side, visited);
        if (ingrPrice == null) { memo.set(key, null); visited.delete(itemId); return null; }
        inputCost += ingrPrice * ingr.quantity;
      }
      const margin = side === 'buy' ? recipe.margin_buy : recipe.margin_sell;
      const outputQty = recipe.output.quantity ?? 1;
      // Margin and multiplier ride on top of (input cost / output quantity).
      // outputQty > 1 only really applies to smelt recipes that produce more
      // than one item per cast; right now everything outputs 1, but keep the
      // math honest.
      price = (inputCost / outputQty) * margin * mult;
    } else {
      const base = side === 'buy' ? entry.listing.base_buy : entry.listing.base_sell;
      if (base == null) { memo.set(key, null); visited.delete(itemId); return null; }
      price = base * mult;
    }

    memo.set(key, price);
    visited.delete(itemId);
    return price;
  }

  return {
    currentPrice: (itemId, side) => currentPrice(itemId, side),
    recipeFor: (itemId) => craftedIndex.get(itemId),
    shopOf: (itemId) => itemIndex.get(itemId),
  };
}
