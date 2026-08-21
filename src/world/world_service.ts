import prisma from '../database/prisma.js';
import { generateTerrain, type TerrainData } from '../combat/terrain.js';
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

export interface ChunkView {
  chunk: Chunk;
  size: number;
  place: Place;
  terrain: TerrainData;
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
  const terrain = generateTerrain(CHUNK_SIZE, CHUNK_SIZE, obstacles, chunkSeed(chunk));

  const rows = await prisma.worldTile.findMany({
    where: { chunk_x: chunk.x, chunk_y: chunk.y },
  });

  return {
    chunk,
    size: CHUNK_SIZE,
    place,
    terrain,
    diffs: rows.map(r => ({
      x: r.tile_x,
      y: r.tile_y,
      kind: r.kind,
      data: (r.data ?? {}) as Record<string, unknown>,
    })),
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
  const where = {
    chunk_x_chunk_y_tile_x_tile_y: {
      chunk_x: args.chunk.x, chunk_y: args.chunk.y, tile_x: args.x, tile_y: args.y,
    },
  };
  const data = {
    kind: args.kind,
    data: (args.data ?? {}) as object,
    account_id: args.accountId ?? null,
  };
  await prisma.worldTile.upsert({
    where,
    update: data,
    create: {
      chunk_x: args.chunk.x, chunk_y: args.chunk.y, tile_x: args.x, tile_y: args.y, ...data,
    },
  });
}

/** Undo a change, so the tile reverts to whatever the generator says. */
export async function clearTile(chunk: Chunk, x: number, y: number): Promise<void> {
  await prisma.worldTile.deleteMany({
    where: { chunk_x: chunk.x, chunk_y: chunk.y, tile_x: x, tile_y: y },
  });
}
