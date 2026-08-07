// Terrain dressing for a combat board.
//
// Purely cosmetic today: the engine still sees a grid of empty squares and
// obstacles. What this adds is the *look* of that grid — a ground material per
// square plus a set of props — so the same board the rules run on can be drawn
// with the pixel-art tileset instead of coloured divs.
//
// It lives server-side (rather than being rolled in the browser) for two
// reasons: every client and every reconnect sees the identical board, and when
// terrain eventually earns gameplay meaning — water you can't cross, a road you
// move faster on — the data is already where the rules live.
//
// Sprite NAMES here must match the atlas in public/terrain.js, which in turn
// mirrors the LAYOUT table in the Asset Library's build-tilesets.lua. That lua
// file is the source of truth for where a sprite sits on the sheet; this file
// only ever refers to sprites by name.

import type { Obstacle, Pos } from './board.js';

// 'g' = grass, 'd' = dirt. One char per square, one string per row.
export type GroundRow = string;

export interface TerrainProp {
  x: number;
  y: number;
  s: string;         // sprite name
}

// An obstacle's dressing. `stack` is bottom-first: stack[0] sits on the blocked
// square itself, stack[1] one square above it, and so on — so a tree's trunk
// base occupies the square that actually blocks movement and its canopy leans
// up into the open squares above, exactly like the hand-drawn maps.
export interface TerrainObstacleProp {
  x: number;
  y: number;
  stack: string[];
  shadow: string | null;
  rubble: string;    // what's drawn once the obstacle is destroyed
}

export interface TerrainData {
  seed: number;
  width: number;
  height: number;
  ground: GroundRow[];
  overlay: TerrainProp[];    // grass tufts — the detail pass over the grass layer
  scatter: TerrainProp[];    // ground-level decor on walkable squares
  obstacles: TerrainObstacleProp[];
}

// ---- deterministic randomness -------------------------------------------
// mulberry32: small, fast, good enough for scatter. Same seed => same board.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

// ---- ground -------------------------------------------------------------
// Value noise on a coarse lattice, bilinearly interpolated. The lattice is
// deliberately larger than one square (LATTICE below) so dirt comes out as
// patches and clearings rather than per-square speckle — speckle would autotile
// into a checkerboard of transition tiles and read as noise, not ground.
const LATTICE = 3.2;              // squares per noise cell
const GRASS_THRESHOLD = 0.42;     // noise above this is grass; ~75-80% of the board

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function makeNoise(r: () => number, w: number, h: number): (x: number, y: number) => number {
  const cols = Math.ceil(w / LATTICE) + 2;
  const rows = Math.ceil(h / LATTICE) + 2;
  const grid: number[] = [];
  for (let i = 0; i < cols * rows; i++) grid.push(r());
  const at = (cx: number, cy: number) =>
    grid[Math.min(rows - 1, Math.max(0, cy)) * cols + Math.min(cols - 1, Math.max(0, cx))];
  return (x, y) => {
    const fx = x / LATTICE, fy = y / LATTICE;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bot * ty;
  };
}

// ---- props --------------------------------------------------------------
const TREE_BOTTOM = 'dec_tree_01_bottom';
const TREE_STUMP  = 'dec_tree_01_stump';

// Two tree builds share the one trunk base (see build-tilesets.lua): variant 01
// is leafy, variant 02 is a bare pole. Both read as "you can't walk here".
const LEAFY_MID = 'dec_tree_01_middle_01';
const LEAFY_TOP = 'dec_tree_01_top_01';
const BARE_MID  = 'dec_tree_01_middle_02';
const BARE_TOP  = 'dec_tree_01_top_02';

const BUSHES   = ['dec_bush_01', 'dec_bush_02', 'dec_bush_03', 'dec_bush_04'] as const;
const BOULDERS = ['dec_rock_01', 'dec_rock_02'] as const;

// Scatter is deliberately all SMALL props. Bushes are the obvious candidates for
// ground clutter and were the first thing tried here — but a bush and a tree's
// canopy are near-identical silhouettes, so a scattered bush reads as a canopy
// with a missing trunk and the player can't tell walkable from blocked at a
// glance. Bushes are obstacles instead (see dressObstacle), which makes the rule
// dead simple: any big leafy mass is a square you can't enter.
const GRASS_SCATTER = [
  'dec_flower_01', 'dec_flower_02', 'dec_grass_01', 'dec_grass_02',
  'dec_rock_01', 'dec_rock_02', 'dec_reed_01',
] as const;

const DIRT_SCATTER = ['dec_rock_01', 'dec_rock_02', 'dec_grass_01'] as const;

const GRASS_TUFTS = ['ov_grass_01', 'ov_grass_02', 'ov_grass_03'] as const;

const SCATTER_CHANCE = 0.10;   // walkable squares that get a small prop
const TUFT_CHANCE    = 0.30;   // grass squares that get a tuft overlay

// A tree is drawn taller than the square it blocks — the trunk base sits on the
// blocked square and the canopy leans up into the squares above. Those squares
// are open, so the only real constraint is the top edge of the board: a tree on
// row 0 has nowhere to put its canopy. Rather than let it clip, an obstacle that
// can't fit its height falls back to something one square tall, which
// incidentally lines the board's top row with bushes, boulders and stumps.
function dressObstacle(r: () => number, pos: Pos): TerrainObstacleProp {
  const headroom = pos.y;
  const at = { x: pos.x, y: pos.y };
  const roll = r();

  if (roll < 0.62 && headroom >= 1) {
    const bare = r() < 0.22;
    const stack = headroom >= 2
      ? [TREE_BOTTOM, bare ? BARE_MID : LEAFY_MID, bare ? BARE_TOP : LEAFY_TOP]
      : [TREE_BOTTOM, bare ? BARE_TOP : LEAFY_TOP];
    return { ...at, stack, shadow: headroom >= 2 ? 'shadow_xl' : 'shadow_lg', rubble: TREE_STUMP };
  }
  if (roll < 0.80) return { ...at, stack: [pick(r, BUSHES)],   shadow: 'shadow_md', rubble: 'dec_grass_02' };
  if (roll < 0.92) return { ...at, stack: [pick(r, BOULDERS)], shadow: 'shadow_md', rubble: 'dec_rock_01' };
  return { ...at, stack: [TREE_STUMP], shadow: 'shadow_sm', rubble: 'dec_rock_01' };
}

// Build the cosmetic layers for a board of the given size and obstacle set.
// Deterministic in `seed` — the same seed and obstacles always produce the same
// dressing.
export function generateTerrain(
  width: number,
  height: number,
  obstacles: Obstacle[],
  seed: number,
): TerrainData {
  const r = rng(seed);
  const noise = makeNoise(r, width, height);

  const blocked = new Set(obstacles.map(o => `${o.pos.x},${o.pos.y}`));

  const ground: GroundRow[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) row += noise(x, y) >= GRASS_THRESHOLD ? 'g' : 'd';
    ground.push(row);
  }

  const overlay: TerrainProp[] = [];
  const scatter: TerrainProp[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isGrass = ground[y][x] === 'g';
      if (isGrass && r() < TUFT_CHANCE) overlay.push({ x, y, s: pick(r, GRASS_TUFTS) });
      // Props only go on squares a unit can stand on — an obstacle square has
      // its own dressing and stacking two props there would read as one prop.
      if (blocked.has(`${x},${y}`)) continue;
      if (r() < SCATTER_CHANCE) {
        scatter.push({ x, y, s: pick(r, isGrass ? GRASS_SCATTER : DIRT_SCATTER) });
      }
    }
  }

  return {
    seed,
    width,
    height,
    ground,
    overlay,
    scatter,
    obstacles: obstacles.map(o => dressObstacle(r, o.pos)),
  };
}
