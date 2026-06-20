// Orchard — the Lumberjack's profession layer (spec: docs/orchard.md).
//
// Pure math + gating only (no DB), mirroring enchant_service.ts. A plot holds a
// planted item; every 4h tick each seeded unit has a price-based chance to spawn
// one more of that item, banked into `accrued` (capped at 24h / 6 ticks). The
// seed is spent on plant and harvest hands over the rolled output, so cheap mats
// are a reliable grind and expensive items a gamble (see expectedMultiplier).
//
// DB orchestration (plant / harvest / scheduler tick) lives in the server, the
// same way /api/enchant drives enchant_service.

// --- Balance knobs (tune K in pacing_sim) ---
// Prices are BUY prices (what the shop charges): wider spread than sell, so items
// fan out across the curve. Breakeven is 6K — at K=12 that's 72, so base mats
// (~50 buy) grind (~1.4×) and tier-2+ (~200) are gambles.
export const ORCHARD_K        = 12;
export const ORCHARD_P_MAX    = 0.5;                  // cap on the BASE (1-fertilizer) per-roll chance
// 4h roll in prod; 5 min on dev/test so the grow→harvest cycle is testable in
// minutes instead of a day (the 6-roll cap then spans 30 min instead of 24h).
export const ORCHARD_TICK_MS  = (process.env.NODE_ENV === 'production' ? 4 * 60 : 5) * 60 * 1000;
export const ORCHARD_CAP_TICKS = 6;                   // accrual caps at 24h (6 rolls)

// Plots unlock at the Enchanter's enchant-level ranks (2/4/6/8/10); count AND
// per-plot capacity both grow, so a higher-rank orchard is more and bigger.
export function orchardCapacity(ljLevel: number): { plots: number; capacity: number } {
  if (ljLevel >= 10) return { plots: 5, capacity: 30 };
  if (ljLevel >= 8)  return { plots: 4, capacity: 25 };
  if (ljLevel >= 6)  return { plots: 3, capacity: 20 };
  if (ljLevel >= 4)  return { plots: 2, capacity: 15 };
  if (ljLevel >= 2)  return { plots: 1, capacity: 10 };
  return { plots: 0, capacity: 0 };
}

// Reallocatable fertilizer pool: one per plot you've unlocked.
export function fertilizerPool(ljLevel: number): number {
  return orchardCapacity(ljLevel).plots;
}

// Fertilizer factor on a plot's chance: 0 → 0.5× (penalty), 1 → 1× (baseline),
// each extra +0.5×. The only thing that can push a plot past P_MAX.
export function fertilizerFactor(fertilizer: number): number {
  return 0.5 + 0.5 * Math.max(0, fertilizer);
}

// Base per-seed-unit chance (one fertilizer / baseline): inverse to price, capped
// at P_MAX. No price (unknown / unsellable) → unplantable → 0.
export function multiplyChance(basePrice: number | undefined | null): number {
  if (typeof basePrice !== 'number' || !(basePrice > 0)) return 0;
  return Math.min(ORCHARD_P_MAX, ORCHARD_K / basePrice);
}

// Actual per-roll multiply chance with fertilizer applied. Fertilizer may push
// past P_MAX, but a probability can't exceed 1.
export function effectiveChance(basePrice: number | undefined | null, fertilizer = 1): number {
  return Math.min(1, multiplyChance(basePrice) * fertilizerFactor(fertilizer));
}

// Expected output ÷ seed over a full cycle. > 1 = net gain (grind), < 1 = a
// gamble you usually lose. Defaults to the 1-fertilizer baseline for previews.
export function expectedMultiplier(basePrice: number | undefined | null, fertilizer = 1): number {
  return ORCHARD_CAP_TICKS * effectiveChance(basePrice, fertilizer);
}

// Is the item worth planting on average at this fertilizer? (UI flags gambles.)
export function isProfitable(basePrice: number | undefined | null, fertilizer = 1): boolean {
  return expectedMultiplier(basePrice, fertilizer) > 1;
}

// One roll's yield for a stack: each of `seedCount` units independently rolls the
// effective chance (binomial). `rng` injectable for tests.
export function rollTickYield(seedCount: number, basePrice: number | undefined | null, fertilizer = 1, rng: () => number = Math.random): number {
  const p = effectiveChance(basePrice, fertilizer);
  if (p <= 0) return 0;
  let extra = 0;
  for (let i = 0; i < seedCount; i++) if (rng() < p) extra++;
  return extra;
}

// A plot's mutable state (matches the OrchardPlot row fields the roll touches).
export interface PlotState {
  item_id: string | null;
  seed_count: number;
  fertilizer: number;
  accrued: number;
  ticks_banked: number;
  last_tick_at: Date;
}

export interface PlotAdvance {
  accrued: number;
  ticks_banked: number;
  last_tick_at: Date;
  changed: boolean;   // true if any tick rolled (caller persists only then)
}

// Roll every roll that has come due since `last_tick_at`, banking them into
// `accrued` and stopping at the 6-roll cap. The clock advances by the rolls
// actually consumed (a partial roll's leftover time carries forward), and a
// restart / downtime just catches up here on the next pass.
export function advancePlot(plot: PlotState, basePrice: number | undefined | null, now: Date, rng: () => number = Math.random): PlotAdvance {
  const unchanged: PlotAdvance = { accrued: plot.accrued, ticks_banked: plot.ticks_banked, last_tick_at: plot.last_tick_at, changed: false };
  if (!plot.item_id || plot.seed_count <= 0) return unchanged;
  if (plot.ticks_banked >= ORCHARD_CAP_TICKS) return unchanged;
  const elapsed = Math.floor((now.getTime() - plot.last_tick_at.getTime()) / ORCHARD_TICK_MS);
  const toRoll = Math.min(elapsed, ORCHARD_CAP_TICKS - plot.ticks_banked);
  if (toRoll <= 0) return unchanged;
  let accrued = plot.accrued;
  for (let i = 0; i < toRoll; i++) accrued += rollTickYield(plot.seed_count, basePrice, plot.fertilizer, rng);
  return {
    accrued,
    ticks_banked: plot.ticks_banked + toRoll,
    last_tick_at: new Date(plot.last_tick_at.getTime() + toRoll * ORCHARD_TICK_MS),
    changed: true,
  };
}

// Rolls remaining before the cap (0 = full, must harvest to resume).
export function ticksUntilCap(plot: Pick<PlotState, 'ticks_banked'>): number {
  return Math.max(0, ORCHARD_CAP_TICKS - plot.ticks_banked);
}

// When the next roll lands (for the page's countdown). Null if at the cap.
export function nextRollAt(plot: Pick<PlotState, 'ticks_banked' | 'last_tick_at'>): Date | null {
  if (plot.ticks_banked >= ORCHARD_CAP_TICKS) return null;
  return new Date(plot.last_tick_at.getTime() + ORCHARD_TICK_MS);
}
