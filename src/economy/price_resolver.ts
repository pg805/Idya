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
import { effectiveMultiplier, xToMultiplier, clamp } from './shop_math.js';

// The logistic map x_{t+1} = R·x·(1−x) has a single stable fixed point at
// (R−1)/R when R ≤ 3, but at R > 3 the fixed point becomes unstable and
// x settles into a period-2 cycle bouncing between two values:
//
//   x± = ((R+1) ± √((R+1)(R−3))) / (2R)
//
// For our purposes (valuables with R up to 3.99), the period-2 envelope is
// what determines the actual price extremes — using the fixed point alone
// underestimates the range. R can range from item.r to item.r_max, so the
// lowest x reached is the period-2 minimum at R_max, and the highest is
// the period-2 maximum at R_max (since both diverge from the fixed point
// as R climbs).
function expectedXRange(rBase: number, rMax: number): { min: number; max: number } {
  const fixedAt = (r: number) => Math.max(0, (r - 1) / r);
  if (rMax <= 3) {
    return { min: fixedAt(rBase), max: fixedAt(rMax) };
  }
  const disc  = Math.max(0, (rMax + 1) * (rMax - 3));
  const sqrtD = Math.sqrt(disc);
  const xMinus = ((rMax + 1) - sqrtD) / (2 * rMax);
  const xPlus  = ((rMax + 1) + sqrtD) / (2 * rMax);
  return {
    min: Math.min(fixedAt(rBase), xMinus),
    max: Math.max(fixedAt(rBase), xPlus),
  };
}

export type Side = 'buy' | 'sell';
export interface PriceRange { min: number; max: number; }

export interface PricingContext {
  currentPrice(itemId: string, side: Side): Promise<number | null>;
  // Expected price range using the R curve's equilibrium x values. The floor
  // is xToMultiplier((R - 1) / R) — what an item with no demand settles to —
  // and the ceiling is xToMultiplier((R_max - 1) / R_max) — peak demand
  // equilibrium. Transaction shocks can briefly push beyond, but this is the
  // "honest day-to-day band" players should see.
  currentRange(itemId: string, side: Side): Promise<PriceRange | null>;
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

  const rangeMemo = new Map<string, PriceRange | null>();

  async function currentRange(itemId: string, side: Side, visited = new Set<string>()): Promise<PriceRange | null> {
    const key = `${itemId}:${side}`;
    if (rangeMemo.has(key)) return rangeMemo.get(key) ?? null;
    if (visited.has(itemId)) return null;
    visited.add(itemId);

    const entry = itemIndex.get(itemId);
    if (!entry) { rangeMemo.set(key, null); visited.delete(itemId); return null; }

    // Structural range only — uses the item's R settings to compute the
    // logistic envelope and turns x directly into a multiplier. Skips
    // effectiveMultiplier so neither current stock nor stock_influence
    // sneaks in; the range is meant to be a stable reference players use
    // to read where the current price sits, not something that moves
    // around with state.
    const xRange = expectedXRange(entry.listing.r, entry.listing.r_max);
    const minMult = xToMultiplier(clamp(xRange.min, 0, 1));
    const maxMult = xToMultiplier(clamp(xRange.max, 0, 1));

    const recipe = craftedIndex.get(itemId);
    let range: PriceRange | null;
    if (recipe) {
      let inputMin = 0, inputMax = 0;
      for (const ingr of recipe.ingredients) {
        const ingrId = ingr.item_id ?? ingr.weapon_id;
        if (!ingrId) { rangeMemo.set(key, null); visited.delete(itemId); return null; }
        const ingrRange = await currentRange(ingrId, side, visited);
        if (!ingrRange) { rangeMemo.set(key, null); visited.delete(itemId); return null; }
        inputMin += ingrRange.min * ingr.quantity;
        inputMax += ingrRange.max * ingr.quantity;
      }
      const margin = side === 'buy' ? recipe.margin_buy : recipe.margin_sell;
      const outputQty = recipe.output.quantity ?? 1;
      range = {
        min: (inputMin / outputQty) * margin * minMult,
        max: (inputMax / outputQty) * margin * maxMult,
      };
    } else {
      const base = side === 'buy' ? entry.listing.base_buy : entry.listing.base_sell;
      if (base == null) { rangeMemo.set(key, null); visited.delete(itemId); return null; }
      range = { min: base * minMult, max: base * maxMult };
    }

    rangeMemo.set(key, range);
    visited.delete(itemId);
    return range;
  }

  return {
    currentPrice: (itemId, side) => currentPrice(itemId, side),
    currentRange: (itemId, side) => currentRange(itemId, side),
    recipeFor: (itemId) => craftedIndex.get(itemId),
    shopOf: (itemId) => itemIndex.get(itemId),
  };
}
