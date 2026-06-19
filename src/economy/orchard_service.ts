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
export const ORCHARD_K        = 3;                    // breakeven at 6K=18: base mats (~10) grind, tier-2+ (~40) gamble. Tune in pacing_sim.
export const ORCHARD_P_MAX    = 0.5;                  // cap on the per-unit multiply chance
export const ORCHARD_TICK_MS  = 4 * 60 * 60 * 1000;   // 4h tick
export const ORCHARD_CAP_TICKS = 6;                   // accrual caps at 24h (6 ticks)

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

// Per-seed-unit chance to spawn one extra unit on a tick — inverse to price,
// capped at P_MAX. No price (unsellable / unknown) → unplantable → 0.
export function multiplyChance(basePrice: number | undefined | null): number {
  if (typeof basePrice !== 'number' || !(basePrice > 0)) return 0;
  return Math.min(ORCHARD_P_MAX, ORCHARD_K / basePrice);
}

// Expected output ÷ seed over a full 24h cycle. > 1 = net gain (grind),
// < 1 = a gamble you usually lose. Breakeven at basePrice = ORCHARD_CAP_TICKS·K.
export function expectedMultiplier(basePrice: number | undefined | null): number {
  return ORCHARD_CAP_TICKS * multiplyChance(basePrice);
}

// Is the item worth planting on average? (UI flags the gambles.)
export function isProfitable(basePrice: number | undefined | null): boolean {
  return expectedMultiplier(basePrice) > 1;
}

// One tick's yield for a stack: each of `seedCount` units independently rolls the
// multiply chance (binomial), so 0..seedCount extra units. `rng` injectable for tests.
export function rollTickYield(seedCount: number, basePrice: number | undefined | null, rng: () => number = Math.random): number {
  const p = multiplyChance(basePrice);
  if (p <= 0) return 0;
  let extra = 0;
  for (let i = 0; i < seedCount; i++) if (rng() < p) extra++;
  return extra;
}

// A plot's mutable state (matches the OrchardPlot row fields the tick touches).
export interface PlotState {
  item_id: string | null;
  seed_count: number;
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

// Roll every tick that has come due since `last_tick_at`, banking the rolls into
// `accrued` and stopping at the 6-tick cap. The clock advances by the ticks
// actually consumed (a partial tick's leftover time carries forward), and a
// restart / downtime just catches up here on the next pass.
export function advancePlot(plot: PlotState, basePrice: number | undefined | null, now: Date, rng: () => number = Math.random): PlotAdvance {
  const unchanged: PlotAdvance = { accrued: plot.accrued, ticks_banked: plot.ticks_banked, last_tick_at: plot.last_tick_at, changed: false };
  if (!plot.item_id || plot.seed_count <= 0) return unchanged;
  if (plot.ticks_banked >= ORCHARD_CAP_TICKS) return unchanged;
  const elapsed = Math.floor((now.getTime() - plot.last_tick_at.getTime()) / ORCHARD_TICK_MS);
  const toRoll = Math.min(elapsed, ORCHARD_CAP_TICKS - plot.ticks_banked);
  if (toRoll <= 0) return unchanged;
  let accrued = plot.accrued;
  for (let i = 0; i < toRoll; i++) accrued += rollTickYield(plot.seed_count, basePrice, rng);
  return {
    accrued,
    ticks_banked: plot.ticks_banked + toRoll,
    last_tick_at: new Date(plot.last_tick_at.getTime() + toRoll * ORCHARD_TICK_MS),
    changed: true,
  };
}

// Ticks remaining before the 24h cap (0 = full, must harvest to resume).
export function ticksUntilCap(plot: Pick<PlotState, 'ticks_banked'>): number {
  return Math.max(0, ORCHARD_CAP_TICKS - plot.ticks_banked);
}
