import type { Server } from 'socket.io';
import prisma from '../database/prisma.js';
import { CHUNK_SIZE, chunkKey, type Chunk } from '../world/chunk.js';
import { ENEMY_KIND } from '../world/spawns.js';
import {
  stepWorld, driveEnemy, exitDirection,
  type AttackShape, type RtUnit, type StepWorld,
} from '../combat/realtime.js';

/**
 * The world, stepping.
 *
 * One simulation per OCCUPIED chunk. There is no combat state and no session
 * (docs/combat.md §1): a chunk with somebody standing in it steps, a chunk with
 * nobody in it does not exist as far as this is concerned. Walk in and you are
 * in whatever is happening there.
 *
 * Positions here are floats in tile units and live in memory. The database keeps
 * the rounded tile, which is all it was ever for — where you were when you shut
 * the tab — so nothing needed a migration.
 */

/** How often the server steps. Fast enough that the client can interpolate. */
const TICK_MS = 50;

/**
 * How fast bodies move, in tiles per second.
 *
 * A tile is 32px, so 5.6 is about 180px a second and crosses a 24-tile chunk in
 * a little over four seconds. The RATIO is the part that matters: a player well
 * clear of an enemy's speed can kite it forever, which is the thing the armour
 * health/speed axis is eventually supposed to price (docs/combat.md §8).
 */
const PLAYER_SPEED = 5.6;
const SWALLOW_SPEED = 3.4;

/**
 * How far an enemy can see, in tiles. TUNE HERE.
 *
 * A third of a chunk, so a bird notices you from across a clearing but not from
 * the far corner, and walking away is a real way out of a fight. Per kit below,
 * so a bigger thing can eventually see further than a small one.
 */
const VISION_TILES = CHUNK_SIZE / 3;

/**
 * Placeholder kits.
 *
 * Weapons are being rebuilt as numbers plus a hitbox shape (docs/items.md), and
 * that format does not exist yet, so these stand in. A swallow's HP is its real
 * Health from database/enemies/lithkem_swallow.yaml; the rest is the harness's
 * tuning, which is the only tuning that has ever been played.
 */
const PLAYER_THRUST: AttackShape = {
  // activeMs is 5 server ticks, which is the thrust animation's length: the
  // hitbox is live for exactly as long as the sword is on screen, so what you
  // see is what hits. 120ms was 2.4 ticks, which drew on two and struck on
  // three.
  //
  // The cooldown runs from the END of the active window, so lengthening it
  // lengthens the whole cycle: 250 + 500 = 750ms a swing, against 620 before.
  // A target is struck once per swing, so this is slower per hit rather than
  // stronger, and the extra window buys forgiveness on a moving target.
  reach: 1, width: 0.45, activeMs: 250, coolMs: 500, tellMs: 0, damage: 16,
};
const SWALLOW_PECK: AttackShape = {
  reach: 1, width: 0.5, activeMs: 140, coolMs: 1100, tellMs: 360, damage: 7,
};
/**
 * `weapon` is the sprite a unit is seen swinging, drawn in place of the plain
 * hitbox rectangle. Cosmetic only, which is why it lives here and not on
 * `AttackShape`: the engine has no notion of sprites and should not grow one.
 * A kit without it keeps the rectangle, which is right for a beak or a claw.
 */
interface EnemyKit {
  hp: number; speed: number; vision: number; attack: AttackShape; weapon?: string;
}
const ENEMY_KITS: Record<string, EnemyKit> = {
  lithkem_swallow:  { hp: 20, speed: SWALLOW_SPEED,        vision: VISION_TILES, attack: SWALLOW_PECK },
  tutorial_swallow: { hp: 20, speed: SWALLOW_SPEED * 0.92, vision: VISION_TILES * 0.75, attack: SWALLOW_PECK },
};
const DEFAULT_KIT = ENEMY_KITS.lithkem_swallow;

/**
 * What the player is seen holding.
 *
 * A constant because there is exactly one placeholder kit to hold anything. It
 * belongs to the weapon, so when weapons become real (docs/items.md) this reads
 * off the equipped one instead.
 */
const PLAYER_WEAPON = 'weapon_sword_01';

export interface SimInput {
  moveX: number;
  moveY: number;
  aim: number;
  attack: boolean;
}

/** What the client needs to draw a unit. Kept small: this goes out 20x a second. */
interface UnitWire {
  id: string;
  team: 'player' | 'enemy';
  name: string;
  sprite: string | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  phase: string;
  aim: number;
  reach: number;
  width: number;
  /** Sprite to draw mid-swing; null means draw the hitbox rectangle. */
  weapon: string | null;
  /** Body radius in tiles. The client hangs a held weapon off it. */
  r: number;
  /** The aim a swing committed to, or null when not swinging. */
  swingAim: number | null;
}

interface Member {
  socketId: string;
  name: string;
  /** Null when a character has no token yet; the client draws a blank. */
  sprite: string | null;
  unit: RtUnit;
}

interface Sim {
  chunk: Chunk;
  world: StepWorld;
  members: Map<string, Member>;
  enemies: RtUnit[];
  /** Sprite and name per enemy id, for the wire. */
  meta: Map<string, { name: string; sprite: string; weapon: string | null }>;
  last: number;
}

export interface WorldSimDeps {
  io: Server;
  chatRoom: (chunk: Chunk) => string;
  /** Solid tiles for a chunk, as blockedBy returns them. */
  blockedIn: (chunk: Chunk) => Promise<Set<string> | null>;
  /** Called once an enemy is dead, so its row can be removed and loot dropped. */
  onEnemyDied?: (chunk: Chunk, rowId: string, at: { x: number; y: number }) => void;
  /**
   * A body has walked into the edge and is still pushing outward.
   *
   * The sim does not know what is next to a chunk, so crossing is the host's
   * job: it decides whether that neighbour exists and moves the presence. The
   * offsets are -1, 0 or 1 per axis, and `along` is the position on the edge
   * being left, so somebody can come out of the other side where they went in.
   */
  onExit?: (args: {
    socketId: string; from: Chunk; dx: number; dy: number; along: { x: number; y: number };
  }) => void;
}

export function createWorldSim(deps: WorldSimDeps) {
  const sims = new Map<string, Sim>();
  let timer: NodeJS.Timeout | null = null;

  async function ensureSim(chunk: Chunk): Promise<Sim> {
    const key = chunkKey(chunk);
    const existing = sims.get(key);
    if (existing) return existing;

    const blocked = (await deps.blockedIn(chunk)) ?? new Set<string>();
    const sim: Sim = {
      chunk,
      world: { blocked, size: CHUNK_SIZE },
      members: new Map(),
      enemies: [],
      meta: new Map(),
      last: Date.now(),
    };
    sims.set(key, sim);
    await loadEnemies(sim);
    return sim;
  }

  async function loadEnemies(sim: Sim): Promise<void> {
    const rows = await prisma.worldObject.findMany({
      where: { chunk_x: sim.chunk.x, chunk_y: sim.chunk.y, kind: ENEMY_KIND },
    });
    sim.enemies = [];
    sim.meta.clear();
    for (const row of rows) {
      const data = (row.data ?? {}) as { enemy?: string };
      const key = data.enemy ?? 'lithkem_swallow';
      const kit = ENEMY_KITS[key] ?? DEFAULT_KIT;
      sim.enemies.push({
        id: row.id, ref: row.id, team: 'enemy',
        // Bodies stand in the middle of the tile they were placed on.
        x: row.tile_x + 0.5, y: row.tile_y + 0.5, r: 0.34,
        hp: kit.hp, maxHp: kit.hp, speed: kit.speed, vision: kit.vision, attack: kit.attack,
        moveX: 0, moveY: 0, aim: Math.random() * Math.PI * 2, wantAttack: false,
        phase: 'idle', tLeft: 0, cool: 0, struck: [], dead: false, throttle: 0,
        // Staggered, so a freshly loaded flock does not turn in unison.
        wanderX: 0, wanderY: 0, wanderMs: Math.random() * 1200,
      });
      sim.meta.set(row.id, {
        name: key.replace(/_/g, ' '), sprite: row.sprite, weapon: kit.weapon ?? null,
      });
    }
  }

  /** Somebody is standing in a chunk. Start it stepping if it was not. */
  async function join(args: {
    socketId: string; chunk: Chunk; tile: { x: number; y: number };
    name: string; sprite: string | null;
  }): Promise<void> {
    const sim = await ensureSim(args.chunk);
    sim.members.set(args.socketId, {
      socketId: args.socketId, name: args.name, sprite: args.sprite,
      unit: {
        id: args.socketId, ref: args.socketId, team: 'player',
        x: args.tile.x + 0.5, y: args.tile.y + 0.5, r: 0.34,
        hp: 100, maxHp: 100, speed: PLAYER_SPEED, vision: 0, attack: PLAYER_THRUST,
        moveX: 0, moveY: 0, aim: 0, wantAttack: false,
        phase: 'idle', tLeft: 0, cool: 0, struck: [], dead: false, throttle: 0,
        wanderX: 0, wanderY: 0, wanderMs: 0,
      },
    });
    start();
  }

  /** Where a body actually is, for anything that still thinks in tiles. */
  function tileOf(socketId: string): { x: number; y: number } | null {
    for (const sim of sims.values()) {
      const m = sim.members.get(socketId);
      if (m) return { x: Math.floor(m.unit.x), y: Math.floor(m.unit.y) };
    }
    return null;
  }

  function leave(socketId: string): void {
    for (const [key, sim] of sims) {
      if (!sim.members.delete(socketId)) continue;
      // A chunk with nobody in it stops existing. Enemies are rows in the
      // database, so their positions are not lost by dropping the sim — they
      // just go back to standing where they were placed.
      if (sim.members.size === 0) sims.delete(key);
    }
    if (sims.size === 0) stop();
  }

  function setInput(socketId: string, input: SimInput): void {
    for (const sim of sims.values()) {
      const m = sim.members.get(socketId);
      if (!m) continue;
      m.unit.moveX = input.moveX;
      m.unit.moveY = input.moveY;
      m.unit.aim = input.aim;
      // Held rather than overwritten: an early press waits for the cooldown
      // instead of being dropped (docs/combat.md §0b).
      if (input.attack) m.unit.wantAttack = true;
      return;
    }
  }

  /** Solid tiles changed under a chunk — somebody felled a tree. */
  async function refreshBlocked(chunk: Chunk): Promise<void> {
    const sim = sims.get(chunkKey(chunk));
    if (!sim) return;
    sim.world.blocked = (await deps.blockedIn(chunk)) ?? new Set<string>();
  }

  /** Enemies were added or removed for a chunk. */
  async function refreshEnemies(chunk: Chunk): Promise<void> {
    const sim = sims.get(chunkKey(chunk));
    if (sim) await loadEnemies(sim);
  }

  function wire(sim: Sim): UnitWire[] {
    const out: UnitWire[] = [];
    for (const m of sim.members.values()) {
      const u = m.unit;
      out.push({
        id: u.id, team: 'player', name: m.name, sprite: m.sprite,
        x: round(u.x), y: round(u.y), hp: Math.round(u.hp), maxHp: u.maxHp,
        phase: u.phase, aim: round(u.aim), reach: u.attack.reach, width: u.attack.width,
        weapon: PLAYER_WEAPON, r: u.r,
        swingAim: u.swingAim === undefined ? null : round(u.swingAim),
      });
    }
    for (const e of sim.enemies) {
      if (e.dead) continue;
      const meta = sim.meta.get(e.id);
      out.push({
        id: e.id, team: 'enemy', name: meta?.name ?? 'thing', sprite: meta?.sprite ?? 'penguin',
        x: round(e.x), y: round(e.y), hp: Math.round(e.hp), maxHp: e.maxHp,
        phase: e.phase, aim: round(e.aim), reach: e.attack.reach, width: e.attack.width,
        weapon: meta?.weapon ?? null, r: e.r,
        swingAim: e.swingAim === undefined ? null : round(e.swingAim),
      });
    }
    return out;
  }
  // Two decimals is a twentieth of a tile: finer than anybody can see, and it
  // keeps the payload small when this goes out twenty times a second.
  const round = (n: number): number => Math.round(n * 100) / 100;

  function tick(): void {
    const now = Date.now();
    for (const sim of sims.values()) {
      const dt = Math.min(0.25, (now - sim.last) / 1000);
      sim.last = now;
      if (dt <= 0) continue;

      const players = [...sim.members.values()].map(m => m.unit);
      const units = [...players, ...sim.enemies];
      for (const e of sim.enemies) driveEnemy(e, players, dt * 1000);

      const events = stepWorld(units, sim.world, dt);

      // Walked into the edge and still pushing at it: that is a crossing. The
      // engine clamps bodies inside the chunk, so "at the edge" is the clamp
      // having just bitten, not a coordinate outside it.
      for (const m of sim.members.values()) {
        const u = m.unit;
        if (u.dead) continue;
        const { dx, dy } = exitDirection(u, CHUNK_SIZE);
        if (!dx && !dy) continue;
        deps.onExit?.({
          socketId: m.socketId, from: sim.chunk, dx, dy,
          along: { x: u.x, y: u.y },
        });
      }

      for (const ev of events) {
        if (ev.kind === 'died' && ev.team === 'enemy') {
          deps.onEnemyDied?.(sim.chunk, ev.ref, ev.at);
        }
      }
      // Dead enemies leave the simulation; their rows are removed by the host.
      if (sim.enemies.some(e => e.dead)) sim.enemies = sim.enemies.filter(e => !e.dead);

      const room = deps.chatRoom(sim.chunk);
      deps.io.to(room).emit('sim:state', { units: wire(sim) });
      if (events.length) {
        deps.io.to(room).emit('sim:events', {
          events: events.filter(e => e.kind !== 'tell'),
        });
      }
    }
  }

  function start(): void {
    if (!timer) timer = setInterval(tick, TICK_MS);
  }
  function stop(): void {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { join, leave, setInput, tileOf, refreshBlocked, refreshEnemies, stop };
}

export type WorldSim = ReturnType<typeof createWorldSim>;
