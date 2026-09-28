import { Chunk, chunkSeed, sameChunk } from './chunk.js';

/**
 * Where you can be, and what the ground there is like.
 *
 * The world is a disc: every chunk within WORLD_RADIUS of the town exists and
 * generates when you walk into it. `PLACES` below is no longer the list of what
 * exists — it is the list of EXCEPTIONS, the handful of chunks somebody has
 * named and tuned by hand. Everything else derives from the chunk seed, which
 * costs nothing to store because the same coordinate always makes the same
 * ground (see chunkSeed in chunk.ts).
 *
 * This reverses world.md's "no hand-authored chunks outside the town". Procgen
 * lays the canvas; a GM pass puts points of interest on top of it. Authoring a
 * place here is how a chunk stops being generic.
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

/**
 * How far out the world goes, in chunks from the town.
 *
 * 1 is the town plus its eight neighbours. Meant to be turned up once there is
 * a reason to walk further; nothing else depends on the number.
 */
export const WORLD_RADIUS = 1;

const PLACES = new Map<string, Place>([
  ['0,0', {
    name: "Sulku'it",
    blurb: 'An open field, and a seam of ore under it.',
    // An empty field. Nothing is generated here on purpose: the town is built
    // by placing things (docs/world.md §3), so the generator's job is to lay
    // down ground to build on and then get out of the way. Bare earth is
    // something you dig, not something you inherit.
    dirt: 0,
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

/** Chebyshev distance from town, so the world is a square disc rather than a cross. */
const ringOf = (c: Chunk): number => Math.max(Math.abs(c.x - TOWN.x), Math.abs(c.y - TOWN.y));

export const inWorld = (c: Chunk): boolean => ringOf(c) <= WORLD_RADIUS;

/**
 * A name for somewhere nobody has named.
 *
 * Deliberately plain and relational rather than invented: a generated chunk
 * says where it is, and inventing lore names for ground nobody has looked at
 * would put fiction in the world that no one chose. Authoring a PLACES entry is
 * what gives a chunk a real name.
 */
function bearing(c: Chunk): string {
  const ns = c.y < TOWN.y ? 'north' : c.y > TOWN.y ? 'south' : '';
  const ew = c.x > TOWN.x ? 'east' : c.x < TOWN.x ? 'west' : '';
  if (ns && ew) return `${ns}-${ew}`;
  return ns || ew || 'around';
}

function generatedPlace(c: Chunk): Place {
  // Its own stream, offset off the terrain's, so the ground and its character
  // don't walk the same sequence.
  let s = (chunkSeed(c) ^ 0x5f356495) >>> 0;
  const next = (): number => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
  return {
    name: `${bearing(c)} of Sulku'it`,
    blurb: 'Open country. Nobody has claimed it.',
    dirt: 0.04 + next() * 0.14,
    obstacles: 16 + Math.floor(next() * 26),
  };
}

export function placeAt(c: Chunk): Place | null {
  const authored = PLACES.get(`${c.x},${c.y}`);
  if (authored) return authored;
  return inWorld(c) ? generatedPlace(c) : null;
}

export const isKnownPlace = (c: Chunk): boolean => placeAt(c) !== null;

/** Every chunk that exists, town first. Authored entries keep their own names. */
export function listPlaces(): Array<Chunk & Place> {
  const out: Array<Chunk & Place> = [];
  for (let y = TOWN.y - WORLD_RADIUS; y <= TOWN.y + WORLD_RADIUS; y++) {
    for (let x = TOWN.x - WORLD_RADIUS; x <= TOWN.x + WORLD_RADIUS; x++) {
      const p = placeAt({ x, y });
      if (p) out.push({ x, y, ...p });
    }
  }
  return out;
}

/** Places you can walk to from here: the four neighbours that exist. */
export function exitsFrom(c: Chunk): Array<Chunk & { name: string }> {
  const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  return dirs
    .map(d => ({ x: c.x + d.x, y: c.y + d.y }))
    .filter(n => !sameChunk(n, c) && isKnownPlace(n))
    .map(n => ({ ...n, name: placeAt(n)!.name }));
}
