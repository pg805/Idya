import fs from 'node:fs';
import path from 'node:path';
import {
  MELEE, PLAYER_MELEE, TICK_MS, swingSequence, swingsOf, swingFor, frameSprite,
  type Swing,
} from '../melee.js';
import { swingAngle, snapAim, SNAP } from '../realtime.js';

// Adding a melee weapon is meant to be one entry plus the drawings. These are
// the things that have to hold for that to be true, so a new weapon either
// passes them or finds out here rather than by looking wrong in the browser.

const SPRITES = path.join(process.cwd(), 'public', 'sprites');

/** Every (weapon, swing) pair, named, for table-driven checks. */
const allSwings: Array<[string, Swing, string]> = Object.entries(MELEE).flatMap(
  ([key, w]) => swingsOf(w).map((sw, i) => [
    `${key} ${i === 0 ? 'light' : 'heavy'}`, sw, w.sprite,
  ] as [string, Swing, string]),
);

describe('swingSequence', () => {
  test('a fixed-angle swing goes out and back', () => {
    expect(swingSequence(3)).toEqual([1, 2, 3, 2, 1]);
    expect(swingSequence(4)).toEqual([1, 2, 3, 4, 3, 2, 1]);
  });

  test('a swept swing runs once, since its angle is the animation', () => {
    // Retracing would walk the blade back along its own arc.
    expect(swingSequence(3, Math.PI / 2)).toEqual([1, 2, 3]);
    expect(swingSequence(5, Math.PI / 2)).toHaveLength(5);
  });

  test('no drawings is one step on the base sprite', () => {
    expect(swingSequence(0)).toEqual([0]);
    expect(swingSequence(0, Math.PI / 2)).toEqual([0]);
  });

  test('a fixed swing starts and ends on the first frame, so holding it loops', () => {
    for (let n = 1; n <= 6; n++) {
      const seq = swingSequence(n);
      expect(seq[0]).toBe(1);
      expect(seq[seq.length - 1]).toBe(1);
      expect(Math.max(...seq)).toBe(n);
    }
  });

  test('nonsense counts fall back to the base sprite rather than throwing', () => {
    // It arrives over a socket, so it can be anything.
    for (const bad of [-3, 1.5, NaN]) {
      expect(swingSequence(bad as number)).toEqual([0]);
    }
  });
});

describe('where a swing points', () => {
  test('a thrust holds the angle it committed to', () => {
    const thrust = MELEE[PLAYER_MELEE].light.shape;
    expect(thrust.spread).toBeUndefined();
    for (const p of [0, 0.5, 1]) {
      expect(swingAngle(thrust, 1.1, p)).toBeCloseTo(1.1, 6);
    }
  });

  test('an arc runs from half a spread behind to half ahead', () => {
    const arc = MELEE[PLAYER_MELEE].heavy!.shape;
    const spread = arc.spread!;
    expect(swingAngle(arc, 0, 0)).toBeCloseTo(-spread / 2, 6);
    expect(swingAngle(arc, 0, 0.5)).toBeCloseTo(0, 6);
    expect(swingAngle(arc, 0, 1)).toBeCloseTo(spread / 2, 6);
  });

  test('so the aim is the middle of the arc, which is where it connects', () => {
    // Point at a thing and the blade passes through it half way through the
    // swing, rather than starting on it and leaving.
    const arc = MELEE[PLAYER_MELEE].heavy!.shape;
    expect(swingAngle(arc, 2, 0.5)).toBeCloseTo(2, 6);
  });

  test('progress outside 0..1 is clamped rather than overswinging', () => {
    const arc = MELEE[PLAYER_MELEE].heavy!.shape;
    expect(swingAngle(arc, 0, -1)).toBeCloseTo(swingAngle(arc, 0, 0), 6);
    expect(swingAngle(arc, 0, 9)).toBeCloseTo(swingAngle(arc, 0, 1), 6);
  });
});

describe('an arc runs between compass points', () => {
  const arc = MELEE[PLAYER_MELEE].heavy!.shape;

  test('a quarter turn is three of the eight points', () => {
    expect(arc.spread).toBeCloseTo(Math.PI / 2, 6);
    expect(arc.spread! / SNAP).toBeCloseTo(2, 6);   // two steps across, three points
  });

  test('aimed near a cardinal it snaps there and runs diagonal to diagonal', () => {
    const aim = snapAim(0.1);                       // roughly east
    expect(aim).toBeCloseTo(0, 6);
    expect(swingAngle(arc, aim, 0) / SNAP).toBeCloseTo(-1, 6);   // north-east
    expect(swingAngle(arc, aim, 1) / SNAP).toBeCloseTo(1, 6);    // south-east
  });

  test('aimed near a diagonal it snaps there and runs cardinal to cardinal', () => {
    const aim = snapAim(SNAP + 0.1);                // roughly south-east
    expect(aim).toBeCloseTo(SNAP, 6);
    expect(swingAngle(arc, aim, 0) / SNAP).toBeCloseTo(0, 6);    // east
    expect(swingAngle(arc, aim, 1) / SNAP).toBeCloseTo(2, 6);    // south
  });

  test('snapping lands on an eighth of a circle, whatever is aimed', () => {
    for (let a = -Math.PI; a <= Math.PI; a += 0.07) {
      const eighths = snapAim(a) / SNAP;
      expect(Math.abs(eighths - Math.round(eighths))).toBeLessThan(1e-9);
      expect(Math.abs(snapAim(a) - a)).toBeLessThanOrEqual(SNAP / 2 + 1e-9);
    }
  });
});

describe('the weapon table', () => {
  test('is not empty, and the player holds something in it', () => {
    expect(Object.keys(MELEE).length).toBeGreaterThan(0);
    expect(MELEE[PLAYER_MELEE]).toBeDefined();
  });

  test.each(allSwings)('%s is a usable attack', (_name, sw) => {
    expect(Number.isInteger(sw.frames)).toBe(true);
    expect(sw.frames).toBeGreaterThanOrEqual(0);
    expect(sw.shape.reach).toBeGreaterThan(0);
    expect(sw.shape.width).toBeGreaterThan(0);
    expect(sw.shape.damage).toBeGreaterThan(0);
    expect(sw.shape.activeMs).toBeGreaterThan(0);
  });

  test.each(allSwings)('%s is timed in whole ticks', (_name, sw) => {
    // The hitbox is live for activeMs and the animation is that same window, so
    // a timing off the tick leaves a fraction where one is true and not the
    // other.
    expect(sw.shape.activeMs % TICK_MS).toBe(0);
    expect(sw.shape.coolMs % TICK_MS).toBe(0);
    expect(sw.shape.tellMs % TICK_MS).toBe(0);
  });

  test.each(allSwings)('%s has every frame it claims, drawn', (_name, sw, sprite) => {
    // The point of the exercise: claim 3 and three files must exist. Claiming
    // one that is not there renders a broken image, and the runtime fallback
    // only catches a weapon with no frames at all.
    for (const frame of swingSequence(sw.frames, sw.shape.spread)) {
      const name = frame === 0 ? sprite : frameSprite({ sprite } as never, frame);
      expect(fs.existsSync(path.join(SPRITES, `${name}.png`))).toBe(true);
    }
  });

  test.each(Object.entries(MELEE))('%s has a single sprite to fall back on', (_key, w) => {
    expect(fs.existsSync(path.join(SPRITES, `${w.sprite}.png`))).toBe(true);
  });

  test('a shape identifies which swing it belongs to', () => {
    // dress() in world_sim leans on this to send the right frame count.
    const w = MELEE[PLAYER_MELEE];
    expect(swingFor(w, w.light.shape)).toBe(w.light);
    expect(swingFor(w, w.heavy!.shape)).toBe(w.heavy);
    expect(swingFor(w, { ...w.light.shape })).toBeNull();
  });
});

describe('what a swing costs', () => {
  // Not balance assertions, which belong in play. These catch a number entered
  // in the wrong unit, which is the realistic mistake.
  test.each(allSwings)('%s swings at a believable rate', (_name, sw) => {
    const cycleMs = sw.shape.tellMs + sw.shape.activeMs + sw.shape.coolMs;
    const perSecond = 1000 / cycleMs;
    expect(perSecond).toBeGreaterThan(0.2);
    expect(perSecond).toBeLessThan(10);
  });

  test.each(allSwings)('%s animates at a visible frame rate', (_name, sw) => {
    const steps = swingSequence(sw.frames, sw.shape.spread).length;
    const perFrame = sw.shape.activeMs / steps;
    expect(perFrame).toBeGreaterThanOrEqual(16);
    expect(perFrame).toBeLessThanOrEqual(300);
  });

  test('the arc trades damage for catching several things', () => {
    const w = MELEE[PLAYER_MELEE];
    expect(w.heavy!.shape.damage).toBeLessThan(w.light.shape.damage);
  });
});
