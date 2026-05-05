import { clamp, xToMultiplier, currentR, logisticStep, effectiveMultiplier } from '../shop_math.js';
import type { ShopItemListing } from '../shop_loader.js';

const baseItem: ShopItemListing = {
  id: 'spores',
  r: 3.2,
  r_max: 3.7,
  volume_sensitivity: 300,
  transaction_threshold: 20,
  stock_max: 80,
  stock_influence: 0.15,
  restock_field: [5],
};

describe('clamp', () => {
  test('within range → unchanged', () => expect(clamp(5, 0, 10)).toBe(5));
  test('below lo → lo',            () => expect(clamp(-1, 0, 10)).toBe(0));
  test('above hi → hi',            () => expect(clamp(11, 0, 10)).toBe(10));
});

describe('xToMultiplier', () => {
  test('x=0   → 0.25×', () => expect(xToMultiplier(0)).toBeCloseTo(0.25));
  test('x=0.5 → 1.0×',  () => expect(xToMultiplier(0.5)).toBeCloseTo(1.0));
  test('x=1   → 4.0×',  () => expect(xToMultiplier(1)).toBeCloseTo(4.0));
  test('strictly increasing', () => {
    expect(xToMultiplier(0.3)).toBeLessThan(xToMultiplier(0.7));
  });
});

describe('currentR', () => {
  test('zero volume → base r', () => {
    expect(currentR(baseItem, 0)).toBeCloseTo(3.2);
  });
  test('very high volume caps at r_max', () => {
    expect(currentR(baseItem, 1_000_000)).toBeCloseTo(3.7);
  });
  test('increases with volume', () => {
    expect(currentR(baseItem, 200)).toBeGreaterThan(currentR(baseItem, 100));
  });
});

describe('logisticStep', () => {
  test('x=0.5, r=3 → 0.75',       () => expect(logisticStep(0.5, 3)).toBeCloseTo(0.75));
  test('x=0 is a fixed point',     () => expect(logisticStep(0, 3.5)).toBe(0));
  test('x=1 collapses to 0',       () => expect(logisticStep(1, 3.5)).toBe(0));
  test('output is always in [0,1]', () => {
    expect(logisticStep(0.5, 10)).toBeLessThanOrEqual(1);
    expect(logisticStep(0.5, 10)).toBeGreaterThanOrEqual(0);
  });
});

describe('effectiveMultiplier', () => {
  test('full stock → cheaper than empty stock (same x)', () => {
    const full  = effectiveMultiplier(baseItem, 0.5, 80);
    const empty = effectiveMultiplier(baseItem, 0.5, 0);
    expect(full).toBeLessThan(empty);
  });
  test('zero stock_influence → pure xToMultiplier', () => {
    const item = { ...baseItem, stock_influence: 0 };
    expect(effectiveMultiplier(item, 0.5, 0)).toBeCloseTo(1.0);
    expect(effectiveMultiplier(item, 0.5, 80)).toBeCloseTo(1.0);
  });
  test('stock_max=0 uses stockRatio=0.5 (no stock adjustment)', () => {
    const item = { ...baseItem, stock_max: 0 };
    expect(effectiveMultiplier(item, 0.5, 0)).toBeCloseTo(1.0);
  });
});
