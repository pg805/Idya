/**
 * The world's coordinate system.
 *
 * The world is a grid of chunks. A chunk is 24x24 tiles of 32px, so 768x768px,
 * which is the size the town was drawn at (docs/world.md §3). Sulku'it is (0,0)
 * and everywhere else radiates out from it.
 *
 * A chunk is a DISCRETE PLACE, not a window onto a continuous world. You are in
 * one at a time and you see it alone. That isn't only a rendering choice: the
 * terrain generator seeds its noise per board and cuts dirt from grass at a
 * quantile of that board's own values, so two neighbours would not line up along
 * their shared edge. Rendering them side by side would need world-space noise
 * and a global cut instead, which is a real change, not a tweak.
 */

export const CHUNK_SIZE = 24;
export const TILE_PX = 32;
export const CHUNK_PX = CHUNK_SIZE * TILE_PX; // 768

export interface Chunk { x: number; y: number; }
/** A tile within a chunk: 0..CHUNK_SIZE-1 on both axes. */
export interface TilePos { x: number; y: number; }

export const chunkKey = (c: Chunk): string => `${c.x},${c.y}`;

export function parseChunkKey(key: string): Chunk | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

export const sameChunk = (a: Chunk, b: Chunk): boolean => a.x === b.x && a.y === b.y;

export function inBounds(p: TilePos): boolean {
  return Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.x < CHUNK_SIZE && p.y >= 0 && p.y < CHUNK_SIZE;
}

/**
 * The seed for the whole world. Changing it regenerates every unauthored chunk,
 * which is a destructive act dressed as a config change: player-made diffs would
 * survive and land on completely different ground. Set once and leave it.
 */
export const WORLD_SEED = Number(process.env.IDYA_WORLD_SEED ?? 20260820);

/**
 * A chunk's terrain seed, derived from the world seed and its coordinates.
 *
 * This is what makes the wilderness persistent without storing it: the same
 * coordinate always generates the same ground, so nothing has to be saved except
 * what players changed (docs/world.md §3).
 *
 * The mixing matters. Naive combinations like `seed + x * 1000 + y` alias badly:
 * distant chunk pairs collide and produce visibly identical terrain. This is a
 * 32-bit integer hash of the three values, avalanched so neighbours share
 * nothing.
 */
export function chunkSeed(chunk: Chunk, worldSeed = WORLD_SEED): number {
  let h = worldSeed | 0;
  for (const v of [chunk.x, chunk.y]) {
    h = Math.imul(h ^ (v | 0), 0x27d4eb2d);
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  }
  h ^= h >>> 16;
  return h >>> 0; // unsigned; generateTerrain wants a positive seed
}

export function parseChunk(raw: unknown): Chunk | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x: x as number, y: y as number };
}

export function parseTilePos(raw: unknown): TilePos | null {
  const p = parseChunk(raw);
  return p && inBounds(p) ? p : null;
}
