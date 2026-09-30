import prisma from '../database/prisma.js';
import { Chunk, CHUNK_SIZE, chunkSeed } from './chunk.js';
import { TOWN, WORLD_RADIUS, placeAt } from './places.js';
import { EDGE_BAND, obstaclesFor, placeObject } from './world_service.js';

/**
 * Enemies standing in the world.
 *
 * They are WorldObject rows with `kind: 'enemy'`, not a table of their own. The
 * model already carries a kind and a data blob, so this needs no migration, and
 * an enemy is a thing at a tile in a chunk exactly the way a barrel is.
 *
 * They are INERT. Walking into one does nothing yet, because the real-time
 * combat that would pick them up does not exist (docs/combat.md §0). This is
 * world-building landing ahead of the engine: the birds are there, and when
 * combat arrives it has something to find.
 */

export const ENEMY_KIND = 'enemy';

/**
 * Placeholder art. Every enemy YAML has `Image: ""` and there are no creature
 * sprites yet (docs/ideas.md: "make art for the enemies"), so a swallow borrows
 * a character token until it has its own.
 */
export const ENEMY_SPRITE: Record<string, string> = {
  lithkem_swallow: 'penguin',
  tutorial_swallow: 'penguin',
};

export const spriteFor = (key: string): string => ENEMY_SPRITE[key] ?? 'penguin';

export interface SeedResult {
  chunks: number;
  placed: number;
  skipped: Array<{ x: number; y: number; had: number }>;
}

/**
 * Put swallows in every chunk except the town.
 *
 * Idempotent per chunk: a chunk that already holds enemies is left alone, so
 * running this twice does not double the flock. Positions come off the chunk
 * seed, so the same chunk always seeds the same way, and they avoid the squares
 * obstacles generate on rather than standing inside a tree.
 */
export async function seedSwallows(opts: {
  key?: string;
  perChunk?: number;
} = {}): Promise<SeedResult> {
  const key = opts.key ?? 'lithkem_swallow';
  const perChunk = opts.perChunk ?? 3;
  const out: SeedResult = { chunks: 0, placed: 0, skipped: [] };

  for (let y = TOWN.y - WORLD_RADIUS; y <= TOWN.y + WORLD_RADIUS; y++) {
    for (let x = TOWN.x - WORLD_RADIUS; x <= TOWN.x + WORLD_RADIUS; x++) {
      const chunk: Chunk = { x, y };
      if (x === TOWN.x && y === TOWN.y) continue;      // the town is a no-combat zone
      const place = placeAt(chunk);
      if (!place) continue;

      const had = await prisma.worldObject.count({
        where: { chunk_x: x, chunk_y: y, kind: ENEMY_KIND },
      });
      if (had > 0) { out.skipped.push({ x, y, had }); continue; }

      const blocked = new Set(obstaclesFor(chunk, place).map(o => `${o.pos.x},${o.pos.y}`));

      // Its own stream again, so spawn points don't track the obstacles.
      let s = (chunkSeed(chunk) ^ 0x2545f491) >>> 0;
      const next = (): number => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;  s >>>= 0;
        return s / 0x100000000;
      };

      // Inside the edge band too: the seam between chunks is where people walk
      // through, and something standing in the doorway reads as a blockage even
      // now that it is not one.
      const span = Math.max(1, CHUNK_SIZE - EDGE_BAND * 2);
      const taken = new Set<string>();
      let placed = 0;
      for (let tries = 0; tries < perChunk * 40 && placed < perChunk; tries++) {
        const tx = EDGE_BAND + Math.floor(next() * span);
        const ty = EDGE_BAND + Math.floor(next() * span);
        const at = `${tx},${ty}`;
        if (blocked.has(at) || taken.has(at)) continue;
        taken.add(at);
        await placeObject({
          chunk, x: tx, y: ty,
          sprite: spriteFor(key),
          kind: ENEMY_KIND,
          data: { enemy: key, hp: null, placeholderArt: true },
        });
        placed++;
      }
      out.chunks++;
      out.placed += placed;
    }
  }
  return out;
}

/** Remove every enemy in the world. The undo for the above. */
export async function clearEnemies(): Promise<number> {
  const res = await prisma.worldObject.deleteMany({ where: { kind: ENEMY_KIND } });
  return res.count;
}
