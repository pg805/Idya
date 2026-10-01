import { swingSequenceFor, type AttackShape } from './realtime.js';

/**
 * Held melee weapons.
 *
 * **Adding one is an entry in `MELEE` plus the drawings.** Nothing in the
 * client or the engine needs touching, because the swing animation is generic
 * over all three things that vary between weapons:
 *
 *   - the **sprite** is a name, and its frames are found at
 *     `public/sprites/<sprite>_<n>.png`, so art is located by being named for
 *     the weapon.
 *   - the **length** is the attack's own `activeMs`, so a heavy weapon animates
 *     slowly without anyone restating the timing. The hitbox is live for
 *     exactly that long, so what is on screen is what hits.
 *   - the **frame count** is `frames`, and the swing plays `swingSequence` —
 *     out and back — so three drawings give five steps and five give nine.
 *
 * Two rules the art has to follow, both enforced by the renderer rather than
 * negotiable:
 *
 *   - It is drawn **pointing up**, tip on the top row and grip on the bottom,
 *     because the renderer turns "up" into the direction of the aim.
 *   - It **spans the whole canvas**. The grip lands on the body's edge and the
 *     tip on the far edge of the hitbox, so padding at either end reads as a
 *     weapon that falls short of what it hits.
 *
 * This lives apart from `world_sim.ts` so it can be read and tested without
 * dragging in the database and the socket server.
 *
 * See `docs/interface-art.md` for the drawing side and `docs/combat.md` for
 * how the timings relate.
 */

/** The server's tick. Timings are whole multiples of it; see the test. */
export const TICK_MS = 50;

/**
 * Pace. A swing's cycle is `tellMs + activeMs + coolMs`, because the cooldown
 * only starts once the hitbox closes — so `coolMs` is the dead time between
 * swings and the dial for how fast a thing attacks. `activeMs` is the
 * animation's length, so it is not: changing it changes what you see.
 *
 * Tuned to roughly Hades' light attack, which chains about three a second. The
 * floor is the animation, since a swing cannot start until the last finishes,
 * so 250ms of thrust caps the player at four a second however small the
 * cooldown gets.
 */
const SWORD_THRUST: AttackShape = {
  // 350ms a swing held down, 2.9 a second, against 690ms and 1.45 before.
  //
  // Measured, not added up: `cool` is decremented at the top of a step and the
  // start check runs later in the same one, so the last cooldown tick is also
  // the tick the next swing begins on. The cycle is one tick short of
  // activeMs + coolMs — 7 ticks, not 8.
  //
  // A target is struck once per swing, so the rate IS the damage: 46/s against
  // 23/s before.
  reach: 1, width: 0.45, activeMs: 250, coolMs: 150, tellMs: 0, damage: 16,
};

/**
 * The arc, on the right button.
 *
 * `spread` is a quarter turn, which is three of the eight compass points, and a
 * swept attack snaps its aim to the nearest of them — so the arc always runs
 * between compass points. Centred on a cardinal it goes diagonal to diagonal;
 * centred on a diagonal it goes cardinal to cardinal. One rule, both cases.
 *
 * The hitbox turns with the blade rather than opening as the whole fan at once,
 * so what is drawn is still what hits. The fan is the area the swing SWEEPS,
 * and at reach 1 a 0.45-wide blade overlaps itself the whole way round, so it
 * covers solidly rather than in slices.
 *
 * Less damage than the thrust, because it can catch several things on the way
 * past: a target is struck once per swing, so three enemies standing in the arc
 * take one hit each.
 */
const SWORD_ARC: AttackShape = {
  reach: 1, width: 0.45, activeMs: 250, coolMs: 250, tellMs: 0,
  damage: 12, spread: Math.PI / 2,
};

/** One attack a weapon can throw: what it does, and how it is drawn. */
export interface Swing {
  shape: AttackShape;
  /**
   * Numbered drawings, at `<sprite>_<n>.png`.
   *
   * **Zero means the base sprite alone**, which is right for a swing that
   * turns: the blade is out the whole way round and its angle is doing the
   * animating, so one drawing is honest rather than lazy. Raise it when there
   * are poses to show.
   */
  frames: number;
}

export interface MeleeWeapon {
  /** Sprite base name in public/sprites/. Frames are `<sprite>_<n>.png`. */
  sprite: string;
  /** The left button. */
  light: Swing;
  /** The right button, if it has one. */
  heavy?: Swing;
}

export const MELEE: Record<string, MeleeWeapon> = {
  sword_01: {
    sprite: 'weapon_sword_01',
    light: { shape: SWORD_THRUST, frames: 3 },
    heavy: { shape: SWORD_ARC, frames: 0 },
  },
};

/** Every swing a weapon has, for walking them. */
export const swingsOf = (w: MeleeWeapon): Swing[] =>
  w.heavy ? [w.light, w.heavy] : [w.light];

/** Which of a weapon's swings a given shape is, or null if it is not one. */
export const swingFor = (w: MeleeWeapon, shape: AttackShape): Swing | null =>
  swingsOf(w).find(sw => sw.shape === shape) ?? null;

/**
 * What the player is holding: a key into `MELEE`.
 *
 * A constant because there is nothing to equip from yet. When weapons become
 * real (`docs/items.md`) this becomes a lookup per character and everything
 * downstream of it stands.
 */
export const PLAYER_MELEE = 'sword_01';

/**
 * The frames a swing plays.
 *
 * Re-exported from the engine, which owns it because the same progress drives
 * the hitbox's angle. `public/views/map.js` mirrors it, since the browser
 * cannot import TypeScript; that one is the copy and this one has the tests.
 */
export const swingSequence = swingSequenceFor;

/** The sprite file a given frame of a weapon's swing is drawn from. */
export const frameSprite = (weapon: MeleeWeapon, frame: number): string =>
  `${weapon.sprite}_${frame}`;
