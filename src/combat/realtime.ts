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
  /** Tiles per second. */
  speed: number;
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
  for (const u of live()) {
    const len = Math.hypot(u.moveX, u.moveY);
    if (len > 0) {
      u.x += (u.moveX / len) * u.speed * dt;
      u.y += (u.moveY / len) * u.speed * dt;
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
 * The enemy's whole mind: close, then swing when in reach.
 *
 * Deliberately thin. The old utility planner scored (destination, action,
 * target) once per round, which has no meaning without rounds, and depth here
 * is not what the game is for (design-rules.md rule 3). What makes a fight
 * readable is the wind-up, not the cleverness.
 */
export function driveEnemy(u: RtUnit, targets: RtUnit[]): void {
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
  if (!best) return;

  u.aim = Math.atan2(best.y - u.y, best.x - u.x);
  // Close to just inside reach, then commit. Stopping short of the hitbox's own
  // length keeps it from shuffling on the boundary.
  if (bestD > u.attack.reach * 0.85 + best.r) {
    u.moveX = Math.cos(u.aim);
    u.moveY = Math.sin(u.aim);
  } else if (u.cool <= 0) {
    u.wantAttack = true;
  }
}
