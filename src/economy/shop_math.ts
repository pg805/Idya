import type { ShopItemListing } from './shop_loader.js';

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// x=0 → 0.25×, x=0.5 → 1.0×, x=1 → 4.0×
export function xToMultiplier(x: number): number {
  return Math.pow(4, 2 * x - 1);
}

// Tighter multiplier used for *crafted* items only. Raw materials still use
// xToMultiplier (the wide [0.25, 4] band), but crafted prices are bounded
// by their input cost and shouldn't swing nearly as wildly — the multiplier
// represents the "cost of crafting" markup floating with demand, not a
// general commodity swing.
//   x=0    → 0.9×  (oversupply floor — crafter taking a slight loss to
//                   move inventory; needs sustained sell shocks)
//   x=0.5  → 1.5×  (resting at the default R=2.0 equilibrium — typical
//                   50% markup over input cost)
//   x=1    → 2.1×  (hot-demand ceiling — premium pricing under heavy buys)
export const CRAFTED_MULT_MIN = 0.9;
export const CRAFTED_MULT_MAX = 2.1;
export function craftedMultiplier(x: number): number {
  return CRAFTED_MULT_MIN + (CRAFTED_MULT_MAX - CRAFTED_MULT_MIN) * x;
}

export function currentR(item: ShopItemListing, recentVolume: number): number {
  if (item.volume_sensitivity === 0) return item.r;
  return Math.min(item.r + (recentVolume / item.volume_sensitivity) * 0.01, item.r_max);
}

// x=0 is a fixed point of the logistic map, so a sustained sell-off that pins x
// near zero would trap the price at the floor forever ("low and stays low").
// Floor x just above zero so the demand state can always climb back toward its
// equilibrium ((r-1)/r), letting prices recover after a shock.
export const X_FLOOR = 0.05;
export function logisticStep(x: number, r: number): number {
  return clamp(r * x * (1 - x), X_FLOOR, 1);
}

export function effectiveMultiplier(item: ShopItemListing, x: number, stock: number): number {
  const stockRatio = item.stock_max > 0 ? stock / item.stock_max : 0.5;
  const effectiveX = clamp(x + (0.5 - stockRatio) * item.stock_influence, 0, 1);
  return xToMultiplier(effectiveX);
}

// Same stock-influence treatment as effectiveMultiplier, but maps the
// adjusted x through craftedMultiplier instead — narrower [0.9, 2.1] band
// for crafted items.
export function effectiveCraftedMultiplier(item: ShopItemListing, x: number, stock: number): number {
  const stockRatio = item.stock_max > 0 ? stock / item.stock_max : 0.5;
  const effectiveX = clamp(x + (0.5 - stockRatio) * item.stock_influence, 0, 1);
  return craftedMultiplier(effectiveX);
}

// Hourly inventory drift — the heart of keeping the market alive. Stock NEVER
// sits still: above HIGH the NPC sells excess off (stock falls), below LOW it
// restocks (stock rises), and in the comfortable middle it drifts randomly.
// This mean-reverts stock toward the [LOW, HIGH] band, which keeps the
// stock-driven price multiplier off the floor — the fix for "prices go low and
// stay low because inventory doesn't change." Magnitude is the rolled
// Restock_Field, forced to at least 1 so something always moves.
export const STOCK_HIGH = 0.60;
export const STOCK_LOW  = 0.20;
export function inventoryStep(
  stock: number,
  stockMax: number,
  restockField: number[],
  rng: () => number = Math.random,
): number {
  if (stockMax <= 0) return stock;
  const ratio = stock / stockMax;
  const mag = Math.max(restockField.length ? restockField[Math.floor(rng() * restockField.length)] : 1, 1);
  let delta: number;
  if (ratio > STOCK_HIGH)     delta = -mag;                       // overstocked → sell off
  else if (ratio < STOCK_LOW) delta =  mag;                       // understocked → restock
  else                        delta = (rng() < 0.5 ? -1 : 1) * mag; // comfortable → drift
  return clamp(stock + delta, 0, stockMax);
}
