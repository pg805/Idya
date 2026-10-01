import type { AttackShape } from './realtime.js';

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

export interface MeleeWeapon {
  /** Sprite base name in public/sprites/. Frames are `<sprite>_<n>.png`. */
  sprite: string;
  /** How many drawings there are. The swing plays 1..n then back to 1. */
  frames: number;
  attack: AttackShape;
}

export const MELEE: Record<string, MeleeWeapon> = {
  sword_01: { sprite: 'weapon_sword_01', frames: 3, attack: SWORD_THRUST },
};

/**
 * What the player is holding: a key into `MELEE`.
 *
 * A constant because there is nothing to equip from yet. When weapons become
 * real (`docs/items.md`) this becomes a lookup per character and everything
 * downstream of it stands.
 */
export const PLAYER_MELEE = 'sword_01';

/**
 * The frames a swing plays, out and back: 1..n, then back down to 1.
 *
 * The tip, more of it, the whole weapon, then the way it came — the retreat
 * reads as the hand pulling in, which is why the sequence is a palindrome
 * rather than a loop. Three drawings cover five steps because 4 and 5 are 2
 * and 1 again.
 *
 * `public/views/map.js` mirrors this as `outAndBack`, because the browser
 * cannot import TypeScript. This is the definition; that is the copy.
 */
export function swingSequence(frames: number): number[] {
  const n = (Number.isInteger(frames) && frames > 0) ? frames : 1;
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i);
  for (let i = n - 1; i >= 1; i--) out.push(i);
  return out;
}

/** The sprite file a given frame of a weapon's swing is drawn from. */
export const frameSprite = (weapon: MeleeWeapon, frame: number): string =>
  `${weapon.sprite}_${frame}`;
