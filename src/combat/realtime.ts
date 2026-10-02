/**
 * Real-time combat, on a tile world with free bodies.
 *
 * Ported from the feel harness in public/harness/combat.html, which is the
 * reference for how this should play. Spec: docs/combat.md.
 *
 * The shape of it:
 *
 *   - Positions are FLOATS in tile units. The world is still a grid — terrain,
 *     objects, everything authored — but a body is a circle that moves freely
 *     over it and can straddle four tiles. (docs/combat.md §0b)
 *   - There is no combat state. No sessions, no arena, no entering or leaving.
 *     Units are in a chunk, and the chunk steps. (§1)
 *   - An attack is an oriented rectangle swept from the body. Its SHAPE is what
 *     distinguishes weapons: a thrust is long and thin, a swing short and wide.
 *   - Nothing here touches the database, the sockets or the clock. It is a pure
 *     step function, so it can be tested without a server.
 */

/** A tile-space position. Floats: the centre of tile 3 is x = 3.5. */
export interface Vec { x: number; y: number }

export type Team = 'player' | 'enemy';

/** What an attack looks like. The numbers a weapon will eventually carry. */
export interface AttackShape {
  /**
   * How far the rectangle reaches BEYOND the body, in tiles.
   *
   * Measured from the body's edge, not its centre, so `sweptLength` is what
   * actually gets swept. A weapon is held at the hand and reaches out from
   * there; measuring from the centre made a unit's own girth eat into its
   * reach, so a fatter enemy would have had a shorter one for free.
   *
   * It is also what lets the drawing tell the truth: the sword sprite's grip
   * sits on the body's edge and its tip on the far edge of the hitbox, both
   * exactly, with the art at 1:1.
   */
  reach: number;
  /** How wide it is, in tiles. Narrow is a thrust, wide is a swing. */
  width: number;
  /** How long the hitbox stays live, in ms. */
  activeMs: number;
  /** How long before it can be thrown again, in ms. */
  coolMs: number;
  /**
   * Radians the hitbox SWEEPS during its active window. Absent means it holds
   * one angle, which is a thrust.
   *
   * A swept rectangle covers a fan: at reach 1 a 0.45-wide blade turned through
   * 90 degrees overlaps itself the whole way round, so the area is solid rather
   * than five separate slices. A target is struck once per swing, so sweeping
   * across three of them hits each one as the blade passes it.
   *
   * A swept attack also SNAPS its committed aim to the nearest eighth of a
   * circle, so the arc runs between compass points: centred on a cardinal it
   * runs diagonal to diagonal, and centred on a diagonal it runs cardinal to
   * cardinal. Those are the same rule, not two cases.
   */
  spread?: number;
  /**
   * Where along the sweep the aimed direction falls, 0 to 1. Default 0.5.
   *
   * 0.5 centres the arc on the aim, so the blade passes through what you
   * pointed at half way through the swing. That is what a short arc wants: aim
   * at a thing and it is cut.
   *
   * 0 starts the swing ON the aim and turns away from there. That is what a
   * full circle wants — centring a 360 on the aim means starting behind
   * yourself and only reaching the mouse half way round, which reads as a
   * delay before the attack arrives.
   *
   * Ignored without `spread`, since a thrust has nowhere to fall along.
   */
  aimAt?: number;
  /**
   * Wind-up before the hitbox appears, in ms.
   *
   * Zero for players: their attacks resolve immediately and cost is what makes
   * one heavy (§4). Enemies get a real wind-up, because a telegraph is the only
   * reason a fight can be dodged rather than merely survived.
   */
  tellMs: number;
  damage: number;
}

export type Phase = 'idle' | 'tell' | 'active';

export interface RtUnit {
  id: string;
  team: Team;
  /** For a player this is the account; for an enemy, its WorldObject row. */
  ref: string;
  x: number;
  y: number;
  /** Body radius in tiles. 0.34 leaves a body a little smaller than its square. */
  r: number;
  hp: number;
  maxHp: number;
  /** Tiles per second, at full intent. */
  speed: number;
  /**
   * How far this thing can see, in tiles. Beyond it, nothing is a target and it
   * goes back to wandering. Zero means it always notices you.
   */
  vision: number;
  attack: AttackShape;

  // ---- intent, set from input or from the AI each step ----
  /** Desired direction of travel. Need not be normalised; the step does that. */
  moveX: number;
  moveY: number;
  /** Where the body is pointing, in radians. */
  aim: number;
  /** Held until it can be spent. An early press is never thrown away (§0b). */
  wantAttack: boolean;

  // ---- derived state, owned by the step ----
  phase: Phase;
  /** Milliseconds left in the current phase. */
  tLeft: number;
  /**
   * The aim a swing committed to, held for its whole active window.
   *
   * The hit test used `aim` live, which re-read the mouse every tick. Harmless
   * at a 120ms window; at 250ms it meant one swing could be spun through a full
   * circle and catch everything around you, since a target is only struck once
   * per swing but the rectangle kept moving. A thrust goes where it was
   * pointed. Undefined outside a swing.
   */
  swingAim?: number;
  /**
   * Further attacks, in slot order from 1. Slot 0 is `attack`.
   *
   * Every unit has a primary, which is why that one is a plain field and is
   * what `driveEnemy` reasons about. Extras are a list so a fourth ability is
   * an append and a key binding rather than another field threaded through
   * five files.
   */
  extras?: AttackShape[];
  /**
   * The slot pressed, or null. Held until a swing can start, so an early
   * press waits for the cooldown rather than being dropped.
   */
  wantSlot?: number | null;
  /**
   * Shove still owed to this body, in tiles, spent over the next few ticks.
   *
   * Carried rather than applied at once so a hit does not teleport anybody;
   * see `KNOCKBACK_TAU`.
   */
  kbX?: number;
  kbY?: number;
  /**
   * The shape of the swing in flight, which is `attack` or `special`.
   *
   * Held for the duration so that releasing the button, or pressing the other
   * one, cannot change what is already in the air.
   */
  using?: AttackShape;
  /** Milliseconds until the attack is available. */
  cool: number;
  /** Ids already hit by the swing in flight, so one swing lands once each. */
  struck: string[];
  dead: boolean;

  /**
   * Effective speed multiplier, eased toward the intent's magnitude.
   *
   * Owned by the step. Without it, a body pottering at 0.4 and then noticing you
   * would snap to 1.0 in a single frame — a 2.5x jump in velocity that reads as
   * a lurch rather than as something starting to run.
   */
  throttle: number;

  // ---- wandering, owned by driveEnemy ----
  /** The heading being idled along, or (0,0) while standing still. */
  wanderX: number;
  wanderY: number;
  /** Milliseconds left before picking a new heading or a new pause. */
  wanderMs: number;
}

export type RtEvent =
  | { kind: 'hit'; by: string; on: string; damage: number; at: Vec }
  | { kind: 'swing'; by: string; aim: number; shape: AttackShape }
  | { kind: 'tell'; by: string; aim: number; shape: AttackShape }
  | { kind: 'died'; id: string; ref: string; team: Team; at: Vec };

export interface StepWorld {
  /** Tiles that a body cannot stand on, as "x,y". Same shape blockedBy returns. */
  blocked: Set<string>;
  /** Chunk extent in tiles. */
  size: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** How long a body takes to reach full speed from a standstill, in seconds. */
const ACCEL_SECONDS = 0.22;

/**
 * How fast an enemy can turn, in radians per second.
 *
 * A creature that snaps to face you the instant it notices reads as a turret.
 * Turning takes a moment, which also gives the wind-up something to aim past:
 * step sideways as it commits and it has to come round.
 */
const TURN_RATE = 7;

/** Shortest signed angle from a to b, so turning never goes the long way. */
function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * How far an attack sweeps from the body's CENTRE.
 *
 * `reach` is measured from the body's edge, so the swept rectangle is that plus
 * the radius. One definition, because the renderer draws to it too: the client
 * puts a weapon's grip at `r` and its tip here (see `.sim-weapon` in map.css).
 */
export const sweptLength = (r: number, reach: number): number => r + reach;

/**
 * The drawings a swing plays through, in order.
 *
 * A fixed-angle swing goes out and back — 1..n then down to 1 — because the
 * extension is the whole animation and the retreat reads as the hand pulling
 * in. A SWEPT swing runs 1..n once, since its angle is doing the animating and
 * retracing would walk the blade back along its own arc.
 *
 * Zero drawings is one step on the base sprite, which is the honest answer for
 * a turning blade that is out the whole way round.
 */
export function swingSequenceFor(frames: number, spread?: number): number[] {
  const n = (Number.isInteger(frames) && frames > 0) ? frames : 0;
  if (n === 0) return [0];
  const out: number[] = [];
  for (let i = 1; i <= n; i++) out.push(i);
  if (!spread) for (let i = n - 1; i >= 1; i--) out.push(i);
  return out;
}

/** The shape in a slot: 0 is the primary, 1 and up are the extras. */
export const slotShape = (u: RtUnit, slot: number): AttackShape | null => (
  slot === 0 ? u.attack : u.extras?.[slot - 1] ?? null
);

/** How many slots a unit can throw. */
export const slotCount = (u: RtUnit): number => 1 + (u.extras?.length ?? 0);

/**
 * How far a hit shoves the thing it lands on, in tiles.
 *
 * Half a square. A quarter was too small to read as being hit.
 */
export const KNOCKBACK = 0.5;

/**
 * How quickly a shove is spent, as a time constant in seconds.
 *
 * The shove is a DECAYING DISPLACEMENT, not a teleport. Instant was wrong twice
 * over: at half a square it is three times a full-speed frame step, so it
 * arrived as a snap, and the body jumped again when it resumed walking. Spread
 * over a few ticks it leaves at a believable speed and slows into a stop, and
 * the client's existing smoothing has something sane to interpolate.
 *
 * Framed as a time constant rather than a frame count so it does not change
 * with the tick rate: each step takes `1 - exp(-dt / tau)` of whatever is left,
 * which is most of it in the first 50ms and the tail inside 150.
 */
export const KNOCKBACK_TAU = 0.06;

/** Below this much left, the rest is not worth a frame. */
const KNOCKBACK_DONE = 0.002;

/**
 * Line a body up to be shoved away from whatever hit it.
 *
 * Directed along attacker-to-target, so it is always directly away from the
 * blow rather than along the aim: being clipped by the edge of a spin pushes
 * you outward from the spinner, which is the direction that reads as being hit.
 *
 * This only records the push. It is SPENT in the movement step, which is what
 * puts it through the same collision as walking, so a shove cannot post
 * somebody through a wall or off the chunk. Two hits landing together stack
 * rather than the second replacing the first.
 */
export function knockBack(
  target: RtUnit, fromX: number, fromY: number, distance = KNOCKBACK,
): void {
  let dx = target.x - fromX, dy = target.y - fromY;
  const d = Math.hypot(dx, dy);
  if (d > 1e-6) { dx /= d; dy /= d; }
  else {
    // Standing exactly on top of each other: no direction to leave by, so use
    // the way the target is facing and shove it forward rather than nowhere.
    dx = Math.cos(target.aim); dy = Math.sin(target.aim);
  }
  target.kbX = (target.kbX ?? 0) + dx * distance;
  target.kbY = (target.kbY ?? 0) + dy * distance;
}

/** Spend a share of whatever shove is left on this body. */
function spendKnockback(u: RtUnit, dt: number): void {
  const left = Math.hypot(u.kbX ?? 0, u.kbY ?? 0);
  if (left < KNOCKBACK_DONE) { u.kbX = 0; u.kbY = 0; return; }
  const share = 1 - Math.exp(-dt / KNOCKBACK_TAU);
  const sx = (u.kbX ?? 0) * share, sy = (u.kbY ?? 0) * share;
  u.x += sx;
  u.y += sy;
  u.kbX = (u.kbX ?? 0) - sx;
  u.kbY = (u.kbY ?? 0) - sy;
}

/** An eighth of a circle: the step a swept attack's aim snaps to. */
export const SNAP = Math.PI / 4;

/** The nearest compass point, of the eight. */
export const snapAim = (aim: number): number => Math.round(aim / SNAP) * SNAP;

/**
 * Where a swing points when it is `progress` of the way through, 0 to 1.
 *
 * A thrust holds the angle it committed to. A swept attack turns through its
 * spread, and `aimAt` says where along that turn the committed aim falls: the
 * middle for a short arc, the start for a full circle.
 *
 * `public/views/map.js` mirrors this so the drawing and the hitbox agree; this
 * is the definition and has the tests on it.
 */
export function swingAngle(
  shape: AttackShape, committed: number, progress: number,
): number {
  if (!shape.spread) return committed;
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const aimAt = shape.aimAt ?? 0.5;
  return committed - shape.spread * aimAt + shape.spread * p;
}

/**
 * Does an oriented rectangle swept from (ux, uy) overlap a circle?
 *
 * The rectangle runs from the body's centre outward along `angle` for `len`,
 * `w` wide — so callers pass `sweptLength`, not `reach` on its own. Works by
 * rotating the target into the rectangle's own frame, where the nearest point
 * is a clamp on each axis.
 */
export function rectHitsCircle(
  ux: number, uy: number, angle: number, len: number, w: number,
  t: { x: number; y: number; r: number },
): boolean {
  const dx = t.x - ux, dy = t.y - uy;
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const nx = clamp(lx, 0, len);
  const ny = clamp(ly, -w / 2, w / 2);
  return Math.hypot(lx - nx, ly - ny) <= t.r;
}

/** Push a body out of any solid tile it has ended up inside. */
function resolveTiles(u: RtUnit, world: StepWorld): void {
  for (let ty = Math.floor(u.y - 1); ty <= Math.floor(u.y + 1); ty++) {
    for (let tx = Math.floor(u.x - 1); tx <= Math.floor(u.x + 1); tx++) {
      if (!world.blocked.has(`${tx},${ty}`)) continue;
      // Nearest point on the tile's box to the body's centre.
      const nx = clamp(u.x, tx, tx + 1);
      const ny = clamp(u.y, ty, ty + 1);
      const dx = u.x - nx, dy = u.y - ny;
      const d = Math.hypot(dx, dy);
      if (d >= u.r) continue;
      if (d > 1e-4) { u.x = nx + (dx / d) * u.r; u.y = ny + (dy / d) * u.r; }
      else {
        // Dead centre of a solid tile: no direction to leave by, so pick the
        // shortest way out rather than dividing by nothing.
        const out = [
          { x: tx - u.r, y: u.y }, { x: tx + 1 + u.r, y: u.y },
          { x: u.x, y: ty - u.r }, { x: u.x, y: ty + 1 + u.r },
        ].sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
        u.x = out.x; u.y = out.y;
      }
    }
  }
}

/** Keep bodies out of each other, splitting the overlap between the pair. */
function resolveBodies(units: RtUnit[]): void {
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j];
      if (a.dead || b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d <= 0 || d >= min) continue;
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push;
      b.x += ux * push; b.y += uy * push;
    }
  }
}

/**
 * Advance the world by `dt` seconds.
 *
 * Order matters and matches the harness: intents move bodies, then bodies are
 * separated, then attacks resolve against where everything ended up. Resolving
 * attacks first would let a body be hit at a position it had already left.
 */
export function stepWorld(units: RtUnit[], world: StepWorld, dt: number): RtEvent[] {
  const events: RtEvent[] = [];
  const ms = dt * 1000;
  const live = (): RtUnit[] => units.filter(u => !u.dead);

  // ---- timers ----
  for (const u of live()) {
    if (u.cool > 0) u.cool = Math.max(0, u.cool - ms);
  }

  // ---- movement ----
  // Direction is normalised, so a diagonal is not faster. Magnitude is a
  // THROTTLE capped at one: a vector of length 0.4 moves at 40% speed, which is
  // how a wandering body potters rather than charging, and anything longer than
  // one (a held diagonal, at sqrt(2)) is simply full speed.
  //
  // Getting faster is EASED, over ACCEL_SECONDS. Slowing down is not: stopping
  // dead is what a player expects from releasing a key, while accelerating
  // instantly is what made a bird lurch the moment it noticed you.
  for (const u of live()) {
    const len = Math.hypot(u.moveX, u.moveY);
    const want = Math.min(1, len);
    if (want > u.throttle) {
      u.throttle = Math.min(want, u.throttle + dt / ACCEL_SECONDS);
    } else {
      u.throttle = want;
    }
    if (len > 1e-6 && u.throttle > 1e-6) {
      u.x += (u.moveX / len) * u.throttle * u.speed * dt;
      u.y += (u.moveY / len) * u.throttle * u.speed * dt;
    }
    // Being shoved is movement too, so it happens here and goes through the
    // same collision below rather than displacing the body behind its back.
    spendKnockback(u, dt);
  }
  resolveBodies(live());
  for (const u of live()) {
    u.x = clamp(u.x, u.r, world.size - u.r);
    u.y = clamp(u.y, u.r, world.size - u.r);
    resolveTiles(u, world);
  }

  // ---- starting an attack ----
  for (const u of live()) {
    // A named slot wins over the bare `wantAttack`, which is what driveEnemy
    // and anything else without slots still sets.
    const slot = u.wantSlot ?? (u.wantAttack ? 0 : null);
    const wants = slot === null ? null : slotShape(u, slot);
    if (!wants || u.phase !== 'idle' || u.cool > 0) continue;
    u.wantAttack = false;
    u.wantSlot = null;
    u.struck = [];
    // Held for the duration: letting go of the button, or pressing the other
    // one, must not change a swing that is already in the air.
    u.using = wants;
    if (wants.tellMs > 0) {
      u.phase = 'tell';
      u.tLeft = wants.tellMs;
      events.push({ kind: 'tell', by: u.id, aim: u.aim, shape: wants });
    } else {
      u.phase = 'active';
      u.tLeft = wants.activeMs;
      u.swingAim = wants.spread ? snapAim(u.aim) : u.aim;
      events.push({ kind: 'swing', by: u.id, aim: u.swingAim, shape: wants });
    }
  }

  // ---- attacks in flight ----
  for (const u of live()) {
    if (u.phase === 'idle') continue;
    const shape = u.using ?? u.attack;
    u.tLeft -= ms;

    if (u.phase === 'tell') {
      if (u.tLeft > 0) continue;
      u.phase = 'active';
      u.tLeft = shape.activeMs;
      u.struck = [];
      // Committed here rather than at the tell, so a wind-up can still be
      // turned: the telegraph shows where it is going and the last moment to
      // read it is the moment it commits.
      u.swingAim = shape.spread ? snapAim(u.aim) : u.aim;
      events.push({ kind: 'swing', by: u.id, aim: u.swingAim, shape });
    }

    if (u.phase === 'active') {
      // Where the blade is NOW. A thrust holds still and a swept attack has
      // turned part of the way through its arc, so the hitbox is wherever the
      // drawing is rather than the whole fan at once.
      const progress = shape.activeMs > 0 ? 1 - u.tLeft / shape.activeMs : 1;
      const aimed = swingAngle(shape, u.swingAim ?? u.aim, progress);
      const swept = sweptLength(u.r, shape.reach);
      for (const t of live()) {
        if (t.team === u.team || u.struck.includes(t.id)) continue;
        if (!rectHitsCircle(u.x, u.y, aimed, swept, shape.width, t)) continue;
        u.struck.push(t.id);
        t.hp = Math.max(0, t.hp - shape.damage);
        // Only lines the shove up; the movement step spends it, so `at` is
        // where the body was struck rather than where it ends up.
        knockBack(t, u.x, u.y);
        events.push({ kind: 'hit', by: u.id, on: t.id, damage: shape.damage, at: { x: t.x, y: t.y } });
        if (t.hp === 0 && !t.dead) {
          t.dead = true;
          t.phase = 'idle';
          events.push({ kind: 'died', id: t.id, ref: t.ref, team: t.team, at: { x: t.x, y: t.y } });
        }
      }
      if (u.tLeft <= 0) {
        u.phase = 'idle';
        u.cool = shape.coolMs;
        u.swingAim = undefined;
        u.using = undefined;
      }
    }
  }

  return events;
}

/**
 * Has this body walked into an edge and is it still pushing at it?
 *
 * Pulled out of the server's tick so it can be tested without sockets. The
 * engine clamps bodies inside the chunk, so "at the edge" means the clamp has
 * just bitten rather than a coordinate outside it — which is why this needs the
 * intent as well as the position. Returns -1, 0 or 1 per axis.
 */
export function exitDirection(u: RtUnit, size: number): { dx: number; dy: number } {
  const atMinX = u.x <= u.r + 1e-3, atMaxX = u.x >= size - u.r - 1e-3;
  const atMinY = u.y <= u.r + 1e-3, atMaxY = u.y >= size - u.r - 1e-3;
  return {
    dx: (atMinX && u.moveX < 0) ? -1 : (atMaxX && u.moveX > 0) ? 1 : 0,
    dy: (atMinY && u.moveY < 0) ? -1 : (atMaxY && u.moveY > 0) ? 1 : 0,
  };
}

/**
 * The enemy's whole mind: look, then chase or potter.
 *
 * Deliberately thin. The old utility planner scored (destination, action,
 * target) once per round, which has no meaning without rounds, and depth here
 * is not what the game is for (design-rules.md rule 3). What makes a fight
 * readable is the wind-up, not the cleverness.
 *
 * `dtMs` is how long since the last call, used only to time the wander.
 */

/*
 * A body has ONE speed.
 *
 * Wandering used to run at 0.4 throttle against a chase's 1.0, so noticing you
 * meant instantly moving two and a half times faster. Easing it over
 * ACCEL_SECONDS was not enough: the jump in speed was the thing that looked
 * wrong, not the abruptness of it. A creature that moves at one speed and
 * simply starts heading for you reads better than one that changes gear.
 *
 * Pace is `speed` on the unit, so a slow thing is slow everywhere, and the
 * difference between pottering and hunting is where it goes and how often it
 * stops — not how fast it travels.
 */
/** How long one wander heading or pause lasts, in ms. */
const WANDER_MIN_MS = 700;
const WANDER_MAX_MS = 2000;
/** How often a new wander decision is a pause rather than a heading. */
const WANDER_PAUSE_CHANCE = 0.45;

export function driveEnemy(u: RtUnit, targets: RtUnit[], dtMs = 0): void {
  u.moveX = 0; u.moveY = 0;
  u.wantAttack = false;
  if (u.dead || u.phase !== 'idle') return;

  let best: RtUnit | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (t.dead) continue;
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    // Nearest, then lowest HP — the same rule the spec settled on (§6).
    if (d < bestD - 1e-6 || (Math.abs(d - bestD) < 1e-6 && best && t.hp < best.hp)) {
      best = t; bestD = d;
    }
  }

  // Out of sight is out of mind. Vision of zero means it always notices.
  if (best && u.vision > 0 && bestD > u.vision) best = null;

  if (!best) { wander(u, dtMs); return; }

  u.wanderMs = 0;                 // drop whatever it was pottering towards

  const wanted = Math.atan2(best.y - u.y, best.x - u.x);
  // Called without timing information, there is no rate to limit by, so face it
  // outright. A zero turn budget would otherwise pin the aim wherever it started.
  const maxTurn = dtMs > 0 ? TURN_RATE * (dtMs / 1000) : Infinity;
  u.aim += clamp(angleTo(u.aim, wanted), -maxTurn, maxTurn);

  // Close to just inside reach, then commit. Stopping short of the hitbox's own
  // length keeps it from shuffling on the boundary. It runs the way it is
  // FACING, not straight at the target, so a turn is something you can see.
  //
  // Scaled by how much it is ALREADY facing the target, which is what stops
  // that turn being a lurch. The facing when a body notices you is whatever
  // its last wander picked, so it could be anything: along a stale heading a
  // swallow spent 200ms travelling the wrong way and came back round in an
  // arc. Now it leans into the turn — nearly still while it comes about, up to
  // speed once it is pointed at you — so the turn is visible without being
  // travel in the wrong direction.
  const facing = Math.max(0, Math.cos(angleTo(u.aim, wanted)));
  if (bestD > sweptLength(u.r, u.attack.reach) * 0.85 + best.r) {
    u.moveX = Math.cos(u.aim) * facing;
    u.moveY = Math.sin(u.aim) * facing;
  } else if (u.cool <= 0) {
    u.wantAttack = true;
  }
}

/**
 * Idle drift: a heading for a while, then a pause, then another heading.
 *
 * Held for a stretch rather than rerolled every frame, because a direction
 * chosen sixty times a second averages to standing still and looks like a
 * twitch. Pauses are half of it — a bird that never stops reads as patrolling.
 */
function wander(u: RtUnit, dtMs: number): void {
  u.wanderMs -= dtMs;
  if (u.wanderMs <= 0) {
    u.wanderMs = WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS);
    if (Math.random() < WANDER_PAUSE_CHANCE) {
      u.wanderX = 0; u.wanderY = 0;
    } else {
      const a = Math.random() * Math.PI * 2;
      u.wanderX = Math.cos(a);
      u.wanderY = Math.sin(a);
      u.aim = a;                  // face where it is going
    }
  }
  u.moveX = u.wanderX;
  u.moveY = u.wanderY;
}
