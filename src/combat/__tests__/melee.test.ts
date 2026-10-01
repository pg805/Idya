import fs from 'node:fs';
import path from 'node:path';
import {
  MELEE, PLAYER_MELEE, TICK_MS, swingSequence, frameSprite,
} from '../melee.js';

// Adding a melee weapon is meant to be one entry plus the drawings. These are
// the things that have to hold for that to be true, so a new weapon either
// passes them or finds out here rather than by looking wrong in the browser.

const SPRITES = path.join(process.cwd(), 'public', 'sprites');

describe('swingSequence', () => {
  test('is out and back, so the retreat reads as pulling in', () => {
    expect(swingSequence(3)).toEqual([1, 2, 3, 2, 1]);
  });

  test('three drawings cover five steps, five cover nine', () => {
    expect(swingSequence(3)).toHaveLength(5);
    expect(swingSequence(5)).toHaveLength(9);
    expect(swingSequence(4)).toEqual([1, 2, 3, 4, 3, 2, 1]);
  });

  test('a single drawing is a still, not an error', () => {
    expect(swingSequence(1)).toEqual([1]);
  });

  test('it starts and ends on the first frame, whatever the count', () => {
    // What makes it loopable: the weapon is back where it started, so holding
    // the attack button does not jump.
    for (let n = 1; n <= 6; n++) {
      const seq = swingSequence(n);
      expect(seq[0]).toBe(1);
      expect(seq[seq.length - 1]).toBe(1);
      expect(Math.max(...seq)).toBe(n);
    }
  });

  test('nonsense counts fall back to a still rather than throwing', () => {
    // It arrives over a socket, so it can be anything.
    for (const bad of [0, -3, 1.5, NaN]) {
      expect(swingSequence(bad as number)).toEqual([1]);
    }
  });
});

describe('the weapon table', () => {
  const entries = Object.entries(MELEE);

  test('is not empty, and the player holds something in it', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(MELEE[PLAYER_MELEE]).toBeDefined();
  });

  test.each(entries)('%s declares a usable weapon', (_key, w) => {
    expect(w.sprite).toMatch(/^weapon_[a-z0-9_]+$/);
    expect(Number.isInteger(w.frames)).toBe(true);
    expect(w.frames).toBeGreaterThanOrEqual(1);
    expect(w.attack.reach).toBeGreaterThan(0);
    expect(w.attack.width).toBeGreaterThan(0);
    expect(w.attack.damage).toBeGreaterThan(0);
    expect(w.attack.activeMs).toBeGreaterThan(0);
  });

  test.each(entries)('%s is timed in whole ticks', (_key, w) => {
    // The hitbox is live for activeMs and the animation is that same window,
    // so a timing that is not a whole number of ticks leaves a fraction of a
    // tick where one is true and the other is not.
    expect(w.attack.activeMs % TICK_MS).toBe(0);
    expect(w.attack.coolMs % TICK_MS).toBe(0);
    expect(w.attack.tellMs % TICK_MS).toBe(0);
  });

  test.each(entries)('%s has every frame it claims, drawn', (_key, w) => {
    // The point of the whole exercise: declare 3 and three files must exist.
    // Claiming a frame that is not there renders a broken image, and the
    // fallback only catches a weapon with NO frames at all.
    for (const frame of swingSequence(w.frames)) {
      const file = path.join(SPRITES, `${frameSprite(w, frame)}.png`);
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  test.each(entries)('%s also has a single sprite to fall back on', (_key, w) => {
    expect(fs.existsSync(path.join(SPRITES, `${w.sprite}.png`))).toBe(true);
  });

  test('frames are named so the renderer can find them', () => {
    const w = MELEE[PLAYER_MELEE];
    expect(frameSprite(w, 2)).toBe(`${w.sprite}_2`);
  });
});

describe('what a swing costs', () => {
  // Not balance assertions, which belong in play. These catch a weapon entered
  // with a number in the wrong unit, which is the realistic mistake: seconds
  // where milliseconds were meant, or a cooldown typed as a reach.
  test.each(Object.entries(MELEE))('%s swings at a believable rate', (_key, w) => {
    const cycleMs = w.attack.tellMs + w.attack.activeMs + w.attack.coolMs;
    const perSecond = 1000 / cycleMs;
    expect(perSecond).toBeGreaterThan(0.2);     // slower than this is a siege
    expect(perSecond).toBeLessThan(10);         // faster is a typo
  });

  test.each(Object.entries(MELEE))('%s animates at a visible frame rate', (_key, w) => {
    const perFrame = w.attack.activeMs / swingSequence(w.frames).length;
    expect(perFrame).toBeGreaterThanOrEqual(16);  // at least one browser frame
    expect(perFrame).toBeLessThanOrEqual(200);    // slower than this is a slideshow
  });
});
