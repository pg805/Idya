import { CHUNK_SIZE, inBounds, type TilePos } from './chunk.js';
import type { Obstacle } from '../combat/board.js';
import { sizeOf, isWalkableSprite } from './sprites.js';

/**
 * Walking around a chunk.
 *
 * Separate from `combat/movement.ts` on purpose: that one spends a movement
 * budget and answers "where can this unit reach this turn". Out of combat there
 * is no budget and no turn, so the question is just "is there a way there", and
 * the answer is a path to walk rather than a set of squares.
 */

export type Blocked = (p: TilePos) => boolean;

/**
 * Squares you cannot walk onto.
 *
 * Standing obstacles, plus anything placed that stands up rather than lying on
 * the ground. Placed objects were passable until now, so a barrel or a house
 * was scenery you strolled through.
 *
 * Only the base of a tree blocks, not the squares its canopy leans over: you
 * walk UNDER branches, which is why the renderer puts them above the tokens.
 * Buildings block their whole footprint, since none of it is sky.
 */
export function blockedBy(
  obstacles: Obstacle[],
  objects: Array<{ x: number; y: number; sprite: string; stack?: string[] }> = [],
): Set<string> {
  const blocked = new Set(
    obstacles
      .filter(o => o.state !== 'destroyed')
      .map(o => `${o.pos.x},${o.pos.y}`),
  );
  for (const o of objects) {
    const base = o.stack?.[0] ?? o.sprite;
    if (isWalkableSprite(base)) continue;
    const [w, h] = sizeOf(o.sprite);
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) blocked.add(`${o.x + dx},${o.y - dy}`);
    }
  }
  return blocked;
}

export function isPassable(p: TilePos, blocked: Set<string>): boolean {
  return inBounds(p) && !blocked.has(`${p.x},${p.y}`);
}

/**
 * The nearest passable square to `from`, searched outward.
 *
 * Used when a stored position turns out to be blocked. Terrain is generated, so
 * a change to the seed or to a place's obstacle count can put a tree where
 * somebody was standing, and being stuck inside it is worse than being nudged
 * a square.
 */
export function nearestFree(from: TilePos, blocked: Set<string>): TilePos {
  if (isPassable(from, blocked)) return from;
  for (let r = 1; r < CHUNK_SIZE; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only the ring at this radius; the inside was covered by smaller r.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = { x: from.x + dx, y: from.y + dy };
        if (isPassable(p, blocked)) return p;
      }
    }
  }
  return from; // a chunk with nowhere to stand; nothing sensible to do
}

const STEPS: TilePos[] = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

/**
 * A walkable path from `from` to `to`, or null if there isn't one.
 *
 * Breadth-first, eight-way. The returned path excludes the starting square and
 * ends on the destination, so it reads as the list of steps to take.
 *
 * Diagonals may not cut a corner between two blocked squares: squeezing
 * diagonally between two trees looks wrong and would let people walk through
 * walls once buildings exist.
 */
export function findPath(from: TilePos, to: TilePos, blocked: Set<string>): TilePos[] | null {
  if (!isPassable(to, blocked) || !inBounds(from)) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const key = (p: TilePos) => `${p.x},${p.y}`;
  const cameFrom = new Map<string, TilePos | null>([[key(from), null]]);
  const queue: TilePos[] = [from];

  while (queue.length) {
    const cur = queue.shift()!;
    for (const step of STEPS) {
      const next = { x: cur.x + step.x, y: cur.y + step.y };
      if (!isPassable(next, blocked)) continue;
      if (cameFrom.has(key(next))) continue;
      // No corner cutting: a diagonal needs at least one of its two orthogonal
      // neighbours open.
      if (step.x !== 0 && step.y !== 0) {
        const sideA = { x: cur.x + step.x, y: cur.y };
        const sideB = { x: cur.x, y: cur.y + step.y };
        if (!isPassable(sideA, blocked) && !isPassable(sideB, blocked)) continue;
      }
      cameFrom.set(key(next), cur);
      if (next.x === to.x && next.y === to.y) {
        const path: TilePos[] = [];
        let at: TilePos | null = next;
        while (at && !(at.x === from.x && at.y === from.y)) {
          path.push(at);
          at = cameFrom.get(key(at)) ?? null;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}
