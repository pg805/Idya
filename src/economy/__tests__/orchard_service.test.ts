import {
  orchardCapacity, fertilizerPool, fertilizerFactor, multiplyChance,
  effectiveChance, expectedMultiplier, isProfitable, rollTickYield, advancePlot,
  ticksUntilCap, nextRollAt,
  ORCHARD_K, ORCHARD_P_MAX, ORCHARD_CAP_TICKS, ORCHARD_TICK_MS,
  type PlotState,
} from '../orchard_service.js';

describe('orchardCapacity / fertilizerPool', () => {
  test('locked below rank 2', () => expect(orchardCapacity(1)).toEqual({ plots: 0, capacity: 0 }));
  test('unlocks at the enchant tiers, growing count and size', () => {
    expect(orchardCapacity(2)).toEqual({ plots: 1, capacity: 10 });
    expect(orchardCapacity(6)).toEqual({ plots: 3, capacity: 30 });
    expect(orchardCapacity(10)).toEqual({ plots: 5, capacity: 50 });
  });
  test('fertilizer pool = plot count', () => {
    expect(fertilizerPool(1)).toBe(0);
    expect(fertilizerPool(2)).toBe(1);
    expect(fertilizerPool(10)).toBe(5);
  });
});

describe('fertilizerFactor', () => {
  test('0 penalty, 1 baseline, +0.5 each', () => {
    expect(fertilizerFactor(0)).toBe(0.5);
    expect(fertilizerFactor(1)).toBe(1);
    expect(fertilizerFactor(2)).toBe(1.5);
    expect(fertilizerFactor(3)).toBe(2);
  });
});

describe('multiplyChance (base, 1-fert)', () => {
  test('inverse to price below the cap', () => expect(multiplyChance(80)).toBeCloseTo(ORCHARD_K / 80));
  test('capped at P_MAX for cheap items', () => expect(multiplyChance(2)).toBe(ORCHARD_P_MAX));
  test('no/invalid price → 0 (unplantable)', () => {
    expect(multiplyChance(undefined)).toBe(0);
    expect(multiplyChance(0)).toBe(0);
  });
});

describe('effectiveChance (fertilizer applied)', () => {
  test('1 fertilizer = the base chance', () => expect(effectiveChance(40, 1)).toBeCloseTo(multiplyChance(40)));
  test('0 fertilizer halves it', () => expect(effectiveChance(40, 0)).toBeCloseTo(multiplyChance(40) * 0.5));
  test('fertilizer can push a capped item past P_MAX', () => {
    // price 2 base = 0.5 (capped); 2 fert ×1.5 = 0.75 > P_MAX.
    expect(effectiveChance(2, 2)).toBeCloseTo(0.75);
  });
  test('but a probability never exceeds 1', () => expect(effectiveChance(2, 3)).toBe(1));
});

describe('expectedMultiplier / breakeven', () => {
  const breakeven = ORCHARD_CAP_TICKS * ORCHARD_K;   // 72 at K=12
  test('base mats (buy ~50) grind at 1 fert', () => {
    expect(expectedMultiplier(50, 1)).toBeGreaterThan(1);
    expect(isProfitable(50, 1)).toBe(true);
  });
  test('tier-2 (buy ~200) is a gamble at 1 fert', () => {
    expect(expectedMultiplier(200, 1)).toBeLessThan(1);
    expect(isProfitable(200, 1)).toBe(false);
  });
  test('flips at the breakeven price (1 fert)', () => expect(expectedMultiplier(breakeven, 1)).toBeCloseTo(1));
  test('fertilizer lifts a gamble (still < 1 deep, but better)', () => {
    expect(expectedMultiplier(200, 3)).toBeGreaterThan(expectedMultiplier(200, 1));
  });
});

describe('rollTickYield', () => {
  test('rng below chance → every unit multiplies', () => expect(rollTickYield(10, 2, 1, () => 0)).toBe(10));
  test('rng above chance → nothing', () => expect(rollTickYield(10, 2, 1, () => 0.99)).toBe(0));
  test('zero-chance item never yields', () => expect(rollTickYield(10, undefined, 1, () => 0)).toBe(0));
  test('0 fertilizer roughly halves the hits', () => {
    // base(80)=0.25; 0-fert=0.125, 1-fert=0.25. rng 0.2 is < 0.25 but > 0.125.
    expect(rollTickYield(10, 80, 0, () => 0.2)).toBe(0);
    expect(rollTickYield(10, 80, 1, () => 0.2)).toBe(10);
  });
});

describe('advancePlot', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const base = (over: Partial<PlotState> = {}): PlotState => ({
    item_id: 'sulwood', seed_count: 10, fertilizer: 1, accrued: 0, ticks_banked: 0, last_tick_at: t0, ...over,
  });

  test('idle plot never advances', () => {
    expect(advancePlot(base({ item_id: null }), 50, new Date(t0.getTime() + 5 * ORCHARD_TICK_MS), () => 0).changed).toBe(false);
  });
  test('no full roll elapsed → no change', () => {
    expect(advancePlot(base(), 50, new Date(t0.getTime() + ORCHARD_TICK_MS - 1), () => 0).changed).toBe(false);
  });
  test('rolls each due roll and advances the clock by rolls consumed', () => {
    const r = advancePlot(base(), 2, new Date(t0.getTime() + 3 * ORCHARD_TICK_MS), () => 0); // chance(2,1)=0.5, rng 0 → all 10
    expect(r.ticks_banked).toBe(3);
    expect(r.accrued).toBe(30);
    expect(r.last_tick_at.getTime()).toBe(t0.getTime() + 3 * ORCHARD_TICK_MS);
  });
  test('caps at 6 rolls after long downtime', () => {
    const r = advancePlot(base(), 2, new Date(t0.getTime() + 100 * ORCHARD_TICK_MS), () => 0);
    expect(r.ticks_banked).toBe(ORCHARD_CAP_TICKS);
    expect(r.accrued).toBe(10 * ORCHARD_CAP_TICKS);
  });
});

describe('ticksUntilCap / nextRollAt', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  test('full when nothing banked', () => expect(ticksUntilCap({ ticks_banked: 0 })).toBe(ORCHARD_CAP_TICKS));
  test('zero at cap', () => expect(ticksUntilCap({ ticks_banked: ORCHARD_CAP_TICKS })).toBe(0));
  test('next roll is one interval out', () => expect(nextRollAt({ ticks_banked: 0, last_tick_at: t0 })!.getTime()).toBe(t0.getTime() + ORCHARD_TICK_MS));
  test('null at cap', () => expect(nextRollAt({ ticks_banked: ORCHARD_CAP_TICKS, last_tick_at: t0 })).toBeNull());
});
