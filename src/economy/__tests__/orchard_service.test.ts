import {
  orchardCapacity, multiplyChance, expectedMultiplier, isProfitable,
  rollTickYield, advancePlot, ticksUntilCap,
  ORCHARD_K, ORCHARD_P_MAX, ORCHARD_CAP_TICKS, ORCHARD_TICK_MS,
  type PlotState,
} from '../orchard_service.js';

describe('orchardCapacity', () => {
  test('locked below rank 2', () => expect(orchardCapacity(1)).toEqual({ plots: 0, capacity: 0 }));
  test('unlocks at the enchant tiers, growing both count and size', () => {
    expect(orchardCapacity(2)).toEqual({ plots: 1, capacity: 10 });
    expect(orchardCapacity(4)).toEqual({ plots: 2, capacity: 15 });
    expect(orchardCapacity(6)).toEqual({ plots: 3, capacity: 20 });
    expect(orchardCapacity(8)).toEqual({ plots: 4, capacity: 25 });
    expect(orchardCapacity(10)).toEqual({ plots: 5, capacity: 30 });
  });
  test('uses the highest unlocked tier between ranks', () => expect(orchardCapacity(5)).toEqual({ plots: 2, capacity: 15 }));
});

describe('multiplyChance', () => {
  test('inverse to price', () => expect(multiplyChance(8)).toBeCloseTo(ORCHARD_K / 8));
  test('capped at P_MAX for cheap items', () => expect(multiplyChance(0.1)).toBe(ORCHARD_P_MAX));
  test('no/invalid price → 0 (unplantable)', () => {
    expect(multiplyChance(undefined)).toBe(0);
    expect(multiplyChance(null)).toBe(0);
    expect(multiplyChance(0)).toBe(0);
  });
});

describe('expectedMultiplier / breakeven', () => {
  // Breakeven is at price = CAP_TICKS·K. Cheaper = grind (>1), pricier = gamble (<1).
  const breakeven = ORCHARD_CAP_TICKS * ORCHARD_K;
  test('cheap mats are a net gain', () => {
    expect(expectedMultiplier(2)).toBeGreaterThan(1);
    expect(isProfitable(2)).toBe(true);
  });
  test('expensive items are a losing gamble', () => {
    expect(expectedMultiplier(50)).toBeLessThan(1);
    expect(isProfitable(50)).toBe(false);
  });
  test('flips at the breakeven price', () => {
    expect(expectedMultiplier(breakeven)).toBeCloseTo(1);
  });
});

describe('rollTickYield', () => {
  test('rng below p → every unit multiplies', () => {
    // p(price 1) = min(0.5, 0.4) = 0.4; rng always 0 → all 10 roll under p.
    expect(rollTickYield(10, 1, () => 0)).toBe(10);
  });
  test('rng above p → nothing multiplies', () => {
    expect(rollTickYield(10, 1, () => 0.99)).toBe(0);
  });
  test('zero-chance item never yields', () => {
    expect(rollTickYield(10, undefined, () => 0)).toBe(0);
  });
});

describe('advancePlot', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const base = (over: Partial<PlotState> = {}): PlotState => ({
    item_id: 'sulwood', seed_count: 10, accrued: 0, ticks_banked: 0, last_tick_at: t0, ...over,
  });

  test('idle plot never advances', () => {
    const r = advancePlot(base({ item_id: null }), 2, new Date(t0.getTime() + 5 * ORCHARD_TICK_MS), () => 0);
    expect(r.changed).toBe(false);
  });

  test('no full tick elapsed → no change', () => {
    const r = advancePlot(base(), 2, new Date(t0.getTime() + ORCHARD_TICK_MS - 1), () => 0);
    expect(r.changed).toBe(false);
  });

  test('rolls each due tick and advances the clock by ticks consumed', () => {
    const r = advancePlot(base(), 2, new Date(t0.getTime() + 3 * ORCHARD_TICK_MS), () => 0); // p(2)=0.2, rng 0 → all 10
    expect(r.ticks_banked).toBe(3);
    expect(r.accrued).toBe(30);   // 10 units × 3 ticks
    expect(r.last_tick_at.getTime()).toBe(t0.getTime() + 3 * ORCHARD_TICK_MS);
    expect(r.changed).toBe(true);
  });

  test('caps at 6 ticks even after long downtime', () => {
    const r = advancePlot(base(), 2, new Date(t0.getTime() + 100 * ORCHARD_TICK_MS), () => 0);
    expect(r.ticks_banked).toBe(ORCHARD_CAP_TICKS);
    expect(r.accrued).toBe(10 * ORCHARD_CAP_TICKS);
  });

  test('already at cap → no further accrual', () => {
    const r = advancePlot(base({ ticks_banked: ORCHARD_CAP_TICKS, accrued: 60, last_tick_at: new Date(t0.getTime() - 999 * ORCHARD_TICK_MS) }), 2, t0, () => 0);
    expect(r.changed).toBe(false);
    expect(r.accrued).toBe(60);
  });
});

describe('ticksUntilCap', () => {
  test('full when nothing banked', () => expect(ticksUntilCap({ ticks_banked: 0 })).toBe(ORCHARD_CAP_TICKS));
  test('zero at cap', () => expect(ticksUntilCap({ ticks_banked: ORCHARD_CAP_TICKS })).toBe(0));
});
