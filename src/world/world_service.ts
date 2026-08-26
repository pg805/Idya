import prisma from '../database/prisma.js';
import {
  generateTerrain, isGrassy, GRASS_TUFTS, TUFT_CHANCE, type TerrainData,
} from '../combat/terrain.js';
import type { Obstacle } from '../combat/board.js';
import { CHUNK_SIZE, chunkSeed, type Chunk } from './chunk.js';
import { placeAt, exitsFrom, type Place } from './places.js';

/**
 * Assembling a chunk.
 *
 * Three layers, in order:
 *   1. generated ground, derived from the coordinate and never stored
 *   2. authored data for places that were designed rather than rolled
 *   3. player and world diffs from WorldTile, laid on top
 *
 * Only the third is persisted. See docs/world.md §3.
 */

export interface WorldDiff {
  x: number;
  y: number;
  kind: string;
  data: Record<string, unknown>;
}

export interface WorldObjectView {
  id: string;
  x: number;
  y: number;
  sprite: string;
  kind: string;
  state: string | null;
  /**
   * Present on things that stand more than one square tall, like a tree: the
   * sprites from the base upward, plus one flip flag for the whole prop. The
   * renderer treats these the way it treats generated props, so a placed tree
   * gets a canopy over the tokens rather than being a flat decal.
   */
  stack?: string[];
  f?: boolean;
  /** Quarter turns clockwise, 0/90/180/270. Single-cell sprites only. */
  rot?: number;
}

/** Ground materials that can be painted. The generator only uses these two. */
export const MATERIALS = ['g', 'd'] as const;
export type Material = typeof MATERIALS[number];

export interface ChunkView {
  chunk: Chunk;
  size: number;
  place: Place;
  terrain: TerrainData;
  /**
   * Board-shaped, because the renderer dresses obstacles from live state rather
   * than from the baked terrain: a destroyed one loses its canopy and becomes
   * rubble. This is where a felled tree stops being a tree.
   */
  obstacles: Obstacle[];
  objects: WorldObjectView[];
  diffs: WorldDiff[];
  exits: Array<Chunk & { name: string }>;
}

/**
 * Obstacles for a chunk, scattered deterministically.
 *
 * generateTerrain dresses obstacles but does not choose where they go, so the
 * placement has to be as reproducible as the terrain is or the ground would be
 * stable while the trees moved. Uses the chunk seed, offset so it doesn't walk
 * the same sequence the terrain does.
 */
function obstaclesFor(chunk: Chunk, place: Place): Obstacle[] {
  let state = (chunkSeed(chunk) ^ 0x9e3779b9) >>> 0;
  const next = () => {
    // xorshift32: small, fast, and identical across processes.
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 0x100000000;
  };

  const taken = new Set<string>();
  const out: Obstacle[] = [];
  // Bounded rather than while-until-satisfied: a dense chunk shouldn't be able
  // to spin looking for the last free square.
  for (let tries = 0; tries < place.obstacles * 12 && out.length < place.obstacles; tries++) {
    const x = Math.floor(next() * CHUNK_SIZE);
    const y = Math.floor(next() * CHUNK_SIZE);
    const key = `${x},${y}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push({ pos: { x, y }, state: 'intact' });
  }
  return out;
}

export async function loadChunk(chunk: Chunk): Promise<ChunkView | null> {
  const place = placeAt(chunk);
  if (!place) return null;

  const obstacles = obstaclesFor(chunk, place);
  const terrain = generateTerrain(CHUNK_SIZE, CHUNK_SIZE, obstacles, chunkSeed(chunk), place.dirt);

  const [rows, objectRows] = await Promise.all([
    prisma.worldTile.findMany({ where: { chunk_x: chunk.x, chunk_y: chunk.y } }),
    prisma.worldObject.findMany({
      where: { chunk_x: chunk.x, chunk_y: chunk.y },
      orderBy: { created_at: 'asc' },
    }),
  ]);

  const diffs: WorldDiff[] = rows.map(r => ({
    x: r.tile_x,
    y: r.tile_y,
    kind: r.kind,
    data: (r.data ?? {}) as Record<string, unknown>,
  }));

  // A 'cleared' diff is somebody having removed what was there. The obstacle
  // still generates, because the ground is derived and can't be edited; what's
  // stored is that it no longer stands.
  const cleared = new Set(
    diffs.filter(d => d.kind === 'cleared').map(d => `${d.x},${d.y}`),
  );

  // Ground edits land on the CORNER lattice, not on squares, because that is
  // where material lives: a square's look comes from its four corners, so
  // digging one square rounds into its neighbours rather than cutting a hard
  // 32px hole. The lattice is one wider and taller than the board.
  for (const d of diffs) {
    if (d.kind !== 'corner') continue;
    const m = d.data.material;
    if (m !== 'g' && m !== 'd') continue;
    const row = terrain.corners[d.y];
    if (row === undefined || d.x < 0 || d.x >= row.length) continue;
    terrain.corners[d.y] = row.slice(0, d.x) + m + row.slice(d.x + 1);
  }

  // Tufts belong to grass, so painted ground has to take them with it. A square
  // turned to dirt loses the ones it had; a square turned back to grass grows
  // its own, at the same odds the generator uses. Rolled from the chunk seed
  // and the square, so a repainted patch looks the same on every load rather
  // than reshuffling itself under anybody standing on it.
  reconcileTufts(terrain, chunk);

  return {
    chunk,
    size: CHUNK_SIZE,
    place,
    terrain,
    obstacles: obstacles.map(o => ({
      ...o,
      state: cleared.has(`${o.pos.x},${o.pos.y}`) ? 'destroyed' : o.state,
    })),
    objects: objectRows.map(viewOf),
    diffs,
    exits: exitsFrom(chunk),
  };
}

/** Record a change to a tile. Upserts, so the newest change to a tile wins. */
export async function setTile(args: {
  chunk: Chunk;
  x: number;
  y: number;
  kind: string;
  data?: Record<string, unknown>;
  accountId?: string | null;
}): Promise<void> {
  // kind is part of the key: the same numbers address a square for 'cleared'
  // and a corner for 'corner', so a change to one must not overwrite the other.
  const where = {
    chunk_x_chunk_y_tile_x_tile_y_kind: {
      chunk_x: args.chunk.x, chunk_y: args.chunk.y,
      tile_x: args.x, tile_y: args.y, kind: args.kind,
    },
  };
  const data = { data: (args.data ?? {}) as object, account_id: args.accountId ?? null };
  await prisma.worldTile.upsert({
    where,
    update: data,
    create: {
      chunk_x: args.chunk.x, chunk_y: args.chunk.y,
      tile_x: args.x, tile_y: args.y, kind: args.kind, ...data,
    },
  });
}

/** Undo a change, so the tile reverts to whatever the generator says. */
export async function clearTile(chunk: Chunk, x: number, y: number, kind?: string): Promise<void> {
  await prisma.worldTile.deleteMany({
    where: { chunk_x: chunk.x, chunk_y: chunk.y, tile_x: x, tile_y: y, ...(kind ? { kind } : {}) },
  });
}

/** Put a square's ground back to whatever the generator says. */
export async function resetSquare(chunk: Chunk, x: number, y: number): Promise<void> {
  await prisma.worldTile.deleteMany({
    where: {
      chunk_x: chunk.x, chunk_y: chunk.y, kind: 'corner',
      tile_x: { in: [x, x + 1] }, tile_y: { in: [y, y + 1] },
    },
  });
}

/**
 * Make the tuft layer agree with the ground beneath it.
 *
 * Only touches squares whose grassiness disagrees with what the generator drew,
 * so an unedited chunk comes out byte-identical to before.
 */
function reconcileTufts(terrain: TerrainData, chunk: Chunk): void {
  const had = new Map(terrain.overlay.map(o => [`${o.x},${o.y}`, o]));
  const out: typeof terrain.overlay = [];

  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const grass = isGrassy(terrain.corners, x, y);
      const existing = had.get(`${x},${y}`);
      if (!grass) continue;                       // dirt keeps nothing
      if (existing) { out.push(existing); continue; }

      // Newly grass: roll for a tuft the way the generator would have.
      let h = (chunkSeed(chunk) ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca77)) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      h ^= h >>> 13;
      const roll = (h >>> 0) / 0x100000000;
      if (roll >= TUFT_CHANCE) continue;
      const pickIdx = (h >>> 8) % GRASS_TUFTS.length;
      out.push({ x, y, s: GRASS_TUFTS[pickIdx], f: ((h >>> 16) & 1) === 1 });
    }
  }
  terrain.overlay = out;
}

// ---- editing ----

/**
 * Paint one SQUARE's material by setting its four corners.
 *
 * Corners are shared with the neighbouring squares, so painting one square
 * bleeds into the four around it. That is the intended behaviour rather than a
 * limitation: it is what makes a dug patch a rounded hollow instead of a
 * 32-pixel hole punched in the grass.
 */
export async function paintSquare(args: {
  chunk: Chunk; x: number; y: number; material: Material; accountId?: string | null;
}): Promise<void> {
  const corners = [
    { x: args.x,     y: args.y },
    { x: args.x + 1, y: args.y },
    { x: args.x,     y: args.y + 1 },
    { x: args.x + 1, y: args.y + 1 },
  ];
  await Promise.all(corners.map(c => prisma.worldTile.upsert({
    where: {
      chunk_x_chunk_y_tile_x_tile_y_kind: {
        chunk_x: args.chunk.x, chunk_y: args.chunk.y, tile_x: c.x, tile_y: c.y, kind: 'corner',
      },
    },
    update: { data: { material: args.material }, account_id: args.accountId ?? null },
    create: {
      chunk_x: args.chunk.x, chunk_y: args.chunk.y, tile_x: c.x, tile_y: c.y,
      kind: 'corner', data: { material: args.material }, account_id: args.accountId ?? null,
    },
  })));
}

export async function placeObject(args: {
  chunk: Chunk; x: number; y: number; sprite: string;
  kind?: string; state?: string | null;
  data?: Record<string, unknown>; ownerAccountId?: string | null;
}): Promise<WorldObjectView> {
  const row = await prisma.worldObject.create({
    data: {
      chunk_x: args.chunk.x, chunk_y: args.chunk.y, tile_x: args.x, tile_y: args.y,
      sprite: args.sprite, kind: args.kind ?? 'decor', state: args.state ?? null,
      data: (args.data ?? {}) as object,
      owner_account_id: args.ownerAccountId ?? null,
    },
  });
  return viewOf(row);
}

function viewOf(row: {
  id: string; tile_x: number; tile_y: number; sprite: string;
  kind: string; state: string | null; data: unknown;
}): WorldObjectView {
  const d = (row.data ?? {}) as { stack?: unknown; f?: unknown; rot?: unknown };
  return {
    id: row.id, x: row.tile_x, y: row.tile_y,
    sprite: row.sprite, kind: row.kind, state: row.state,
    ...(Array.isArray(d.stack) ? { stack: d.stack as string[] } : {}),
    ...(d.f ? { f: true } : {}),
    ...(typeof d.rot === 'number' && d.rot ? { rot: d.rot } : {}),
  };
}

/**
 * Swap one sprite inside a standing tree, or add one directly above its top.
 *
 * A tree is a column of sprites kept on a single row, so editing one part is a
 * change to that row rather than a new object: placing a middle over a middle
 * should change that middle and leave the tree standing.
 *
 * Returns the updated object, or null if the square isn't part of this tree and
 * isn't the square immediately above it.
 */
export async function editTreePart(
  id: string, stack: string[], anchorY: number, y: number, sprite: string,
): Promise<WorldObjectView | null> {
  const index = anchorY - y;              // 0 is the base, upward from there
  if (index < 0 || index > stack.length) return null;

  const next = stack.slice();
  if (index === stack.length) next.push(sprite);   // one above the top: grow it
  else next[index] = sprite;

  const row = await prisma.worldObject.findUnique({ where: { id } });
  if (!row) return null;
  const data = (row.data ?? {}) as Record<string, unknown>;
  const updated = await prisma.worldObject.update({
    where: { id },
    // sprite mirrors the base of the stack, which is what a one-cell reader
    // (a shadow lookup, a listing) sees.
    data: { sprite: next[0], data: { ...data, stack: next } },
  });
  return viewOf(updated);
}

export async function removeObject(id: string): Promise<void> {
  await prisma.worldObject.delete({ where: { id } }).catch(() => { /* already gone */ });
}

/** Remove the most recently placed object on a square, or nothing. */
export async function removeTopObject(chunk: Chunk, x: number, y: number): Promise<string | null> {
  const row = await prisma.worldObject.findFirst({
    where: { chunk_x: chunk.x, chunk_y: chunk.y, tile_x: x, tile_y: y },
    orderBy: { created_at: 'desc' },
  });
  if (!row) return null;
  await prisma.worldObject.delete({ where: { id: row.id } });
  return row.id;
}
