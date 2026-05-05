import type { ShopItemListing } from './shop_loader.js';

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// x=0 → 0.25×, x=0.5 → 1.0×, x=1 → 4.0×
export function xToMultiplier(x: number): number {
  return Math.pow(4, 2 * x - 1);
}

export function currentR(item: ShopItemListing, recentVolume: number): number {
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
