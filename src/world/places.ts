import { Chunk, sameChunk } from './chunk.js';

/**
 * Named places, keyed by chunk coordinate.
 *
 * Authored data, deliberately small. A chunk with an entry here is somewhere a
 * player can be; everywhere else is not reachable yet. When the world grows past
 * a handful of places this becomes a file or a table, but the read path stays
 * "what is at this coordinate", so callers won't notice.
 */

export interface Place {
  name: string;
  blurb: string;
  /**
   * How much of the ground is bare dirt, 0..1. The town is a cleared field, the
   * forest is not, and this is the knob that says so.
   */
  dirt: number;
  /** Roughly how many obstacles (trees, rocks) the generator should scatter. */
  obstacles: number;
}

const PLACES = new Map<string, Place>([
  ['0,0', {
    name: "Sulku'it",
    blurb: 'An open field, and a seam of ore under it.',
    // An empty field. Nothing is generated here on purpose: the town is built
    // by placing things (docs/world.md §3), so the generator's job is to lay
    // down ground to build on and then get out of the way.
    dirt: 0.04,
    obstacles: 0,
  }],
  ['1,0', {
    name: 'Sulkupa Forest',
    blurb: 'The trees east of camp.',
    dirt: 0.1,
    obstacles: 34,
  }],
]);

export const TOWN: Chunk = { x: 0, y: 0 };

export function placeAt(c: Chunk): Place | null {
  return PLACES.get(`${c.x},${c.y}`) ?? null;
}

export const isKnownPlace = (c: Chunk): boolean => placeAt(c) !== null;

export function listPlaces(): Array<Chunk & Place> {
  return [...PLACES.entries()].map(([key, p]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, ...p };
  });
}

/** Places you can walk to from here: the four neighbours that exist. */
export function exitsFrom(c: Chunk): Array<Chunk & { name: string }> {
  const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  return dirs
    .map(d => ({ x: c.x + d.x, y: c.y + d.y }))
    .filter(n => !sameChunk(n, c) && isKnownPlace(n))
    .map(n => ({ ...n, name: placeAt(n)!.name }));
}
