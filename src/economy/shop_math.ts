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

export function logisticStep(x: number, r: number): number {
  return clamp(r * x * (1 - x), 0, 1);
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
