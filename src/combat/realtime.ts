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
  /** How far the rectangle reaches, in tiles. */
  reach: number;
  /** How wide it is, in tiles. Narrow is a thrust, wide is a swing. */
  width: number;
  /** How long the hitbox stays live, in ms. */
  activeMs: number;
  /** How long before it can be thrown again, in ms. */
  coolMs: number;
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
 * Does an oriented rectangle swept from (ux, uy) overlap a circle?
 *
 * The rectangle runs from the body's centre outward along `angle` for `len`,
 * `w` wide. Works by rotating the target into the rectangle's own frame, where
 * the nearest point is a clamp on each axis.
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
  }
  resolveBodies(live());
  for (const u of live()) {
    u.x = clamp(u.x, u.r, world.size - u.r);
    u.y = clamp(u.y, u.r, world.size - u.r);
    resolveTiles(u, world);
  }

  // ---- starting an attack ----
  for (const u of live()) {
    if (!u.wantAttack || u.phase !== 'idle' || u.cool > 0) continue;
    u.wantAttack = false;
    u.struck = [];
    if (u.attack.tellMs > 0) {
      u.phase = 'tell';
      u.tLeft = u.attack.tellMs;
      events.push({ kind: 'tell', by: u.id, aim: u.aim, shape: u.attack });
    } else {
      u.phase = 'active';
      u.tLeft = u.attack.activeMs;
      events.push({ kind: 'swing', by: u.id, aim: u.aim, shape: u.attack });
    }
  }

  // ---- attacks in flight ----
  for (const u of live()) {
    if (u.phase === 'idle') continue;
    u.tLeft -= ms;

    if (u.phase === 'tell') {
      if (u.tLeft > 0) continue;
      u.phase = 'active';
      u.tLeft = u.attack.activeMs;
      u.struck = [];
      events.push({ kind: 'swing', by: u.id, aim: u.aim, shape: u.attack });
    }

    if (u.phase === 'active') {
      for (const t of live()) {
        if (t.team === u.team || u.struck.includes(t.id)) continue;
        if (!rectHitsCircle(u.x, u.y, u.aim, u.attack.reach, u.attack.width, t)) continue;
        u.struck.push(t.id);
        t.hp = Math.max(0, t.hp - u.attack.damage);
        events.push({ kind: 'hit', by: u.id, on: t.id, damage: u.attack.damage, at: { x: t.x, y: t.y } });
        if (t.hp === 0 && !t.dead) {
          t.dead = true;
          t.phase = 'idle';
          events.push({ kind: 'died', id: t.id, ref: t.ref, team: t.team, at: { x: t.x, y: t.y } });
        }
      }
      if (u.tLeft <= 0) {
        u.phase = 'idle';
        u.cool = u.attack.coolMs;
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

/** How far a wandering body drifts, as a fraction of its speed. */
const WANDER_THROTTLE = 0.4;
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
  if (bestD > u.attack.reach * 0.85 + best.r) {
    u.moveX = Math.cos(u.aim);
    u.moveY = Math.sin(u.aim);
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
      u.wanderX = Math.cos(a) * WANDER_THROTTLE;
      u.wanderY = Math.sin(a) * WANDER_THROTTLE;
      u.aim = a;                  // face where it is going
    }
  }
  u.moveX = u.wanderX;
  u.moveY = u.wanderY;
}
