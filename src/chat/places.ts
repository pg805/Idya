/**
 * Named places, keyed by chunk coordinate.
 *
 * A stopgap with a deliberate shape. Chat is scoped to a chunk from day one so
 * that nothing migrates when the world map arrives (docs/world.md §3), but until
 * the map exists there is nowhere to read names from, so the handful that exist
 * are listed here.
 *
 * When the map lands this table goes away and names come from the authored
 * chunks instead. Callers only ever ask "what is this coordinate called", so
 * swapping the source is a one-function change.
 */

export interface Chunk { x: number; y: number; }

export const TOWN: Chunk = { x: 0, y: 0 };

const PLACES: Array<{ chunk: Chunk; name: string; blurb: string }> = [
  { chunk: { x: 0, y: 0 }, name: "Sulku'it", blurb: 'A field, a few tents, and a seam of ore.' },
  { chunk: { x: 1, y: 0 }, name: 'Sulkupa Forest', blurb: 'The trees east of camp.' },
];

export const chunkKey = (c: Chunk): string => `${c.x},${c.y}`;

export function placeAt(c: Chunk): { name: string; blurb: string } | null {
  const found = PLACES.find(p => p.chunk.x === c.x && p.chunk.y === c.y);
  return found ? { name: found.name, blurb: found.blurb } : null;
}

/** Somewhere a player is allowed to stand today. The map will replace this. */
export function isKnownPlace(c: Chunk): boolean {
  return placeAt(c) !== null;
}

export function listPlaces(): Array<{ x: number; y: number; name: string; blurb: string }> {
  return PLACES.map(p => ({ x: p.chunk.x, y: p.chunk.y, name: p.name, blurb: p.blurb }));
}

export function parseChunk(raw: unknown): Chunk | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x: x as number, y: y as number };
}
