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
  f: boolean;        // draw mirrored — see the flip note on TerrainObstacleProp
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
  // Mirror the sprite horizontally. Cheap variety from a small sprite set — a
  // board of trees stops looking stamped. One flag for the WHOLE stack, not per
  // sprite: flipping a trunk segment independently of the one below it would
  // break the tree apart down the middle.
  f: boolean;
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
// These fights happen in a forest, so the board is grass and dirt is the
// exception — bare earth showing through here and there, not terrain in its own
// right. Value noise on a fine lattice with a low threshold gives exactly that:
// only the deepest dips in the field become dirt, so patches come out small and
// scattered (~8% of squares, most of them one or two squares across) instead of
// as the big clearings a mid threshold produces.
//
// Small is safe here because of the dual-grid autotiling: a lone dirt square
// isn't drawn as a hard square of dirt, it's four corner tiles meeting, which
// reads as a rounded scuff worn into the grass.
const LATTICE = 1.4;             // squares per noise cell
const DIRT_THRESHOLD = 0.18;     // noise BELOW this is dirt; everything else grass

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

// The two tops and the two middles are interchangeable parts, not two fixed tree
// builds — any top sits on any middle. Top 01 is the leafy canopy and carries
// most trees; top 02 (the capped bare trunk) is the occasional dead one.
const TREE_TOP_MAIN = 'dec_tree_01_top_01';
const TREE_TOP_ALT  = 'dec_tree_01_top_02';
const TREE_MIDS = ['dec_tree_01_middle_01', 'dec_tree_01_middle_02'] as const;
const TREE_TOP_ALT_CHANCE = 0.10;
const TREE_TALL_CHANCE    = 0.55;   // 3 squares tall vs 2, where there's headroom

const BUSHES = ['dec_bush_01', 'dec_bush_02', 'dec_bush_03', 'dec_bush_04'] as const;

// Scatter is small ground clutter only — flowers and pebbles. Two things are
// deliberately absent:
//
// Bushes, because a bush and a tree's canopy are near-identical silhouettes, so
// a scattered bush reads as a canopy with a missing trunk and the player can't
// tell walkable from blocked at a glance. They're obstacles instead, which keeps
// the rule dead simple: any big leafy mass is a square you can't enter.
//
// The dec_grass_* blades, because the ov_grass_* tufts already do that job on
// the overlay layer and two kinds of loose greenery just muddies it.
const GRASS_SCATTER = ['dec_flower_01', 'dec_flower_02', 'dec_rock_01'] as const;
const DIRT_SCATTER  = ['dec_rock_01'] as const;

const GRASS_TUFTS = ['ov_grass_01', 'ov_grass_02', 'ov_grass_03'] as const;

const SCATTER_CHANCE = 0.10;   // walkable squares that get a small prop
const TUFT_CHANCE    = 0.30;   // grass squares that get a tuft overlay

// A tree is drawn taller than the square it blocks — the trunk base sits on the
// blocked square and the rest leans up into the squares above. Those squares are
// open, so the only real constraint is the top edge of the board: a tree on row 0
// has nowhere to put its canopy, and one on row 1 only has room to be short.
function treeStack(r: () => number, headroom: number): string[] {
  const top = r() < TREE_TOP_ALT_CHANCE ? TREE_TOP_ALT : TREE_TOP_MAIN;
  const tall = headroom >= 2 && r() < TREE_TALL_CHANCE;
  return tall ? [TREE_BOTTOM, pick(r, TREE_MIDS), top] : [TREE_BOTTOM, top];
}

// Forest floor: overwhelmingly trees, with the occasional bush or stump for
// low cover. An obstacle with no headroom for a tree becomes a stump rather than
// a bush — bushes are meant to stay rare, not to pile up along the top row.
function dressObstacle(r: () => number, pos: Pos): TerrainObstacleProp {
  const headroom = pos.y;
  const at = { x: pos.x, y: pos.y, f: r() < 0.5 };
  const roll = r();

  if (roll < 0.88) {
    // A tree that has nowhere to grow becomes a stump, NOT a bush — falling
    // through to the bush branch here would pile every top-row obstacle into
    // the one prop that's supposed to stay rare.
    if (headroom < 1) return { ...at, stack: [TREE_STUMP], shadow: 'shadow_sm', rubble: 'dec_rock_01' };
    const stack = treeStack(r, headroom);
    return { ...at, stack, shadow: stack.length > 2 ? 'shadow_xl' : 'shadow_lg', rubble: TREE_STUMP };
  }
  if (roll < 0.95) return { ...at, stack: [pick(r, BUSHES)], shadow: 'shadow_md', rubble: 'dec_rock_01' };
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
    for (let x = 0; x < width; x++) row += noise(x, y) < DIRT_THRESHOLD ? 'd' : 'g';
    ground.push(row);
  }

  const overlay: TerrainProp[] = [];
  const scatter: TerrainProp[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isGrass = ground[y][x] === 'g';
      if (isGrass && r() < TUFT_CHANCE) {
        overlay.push({ x, y, s: pick(r, GRASS_TUFTS), f: r() < 0.5 });
      }
      // Props only go on squares a unit can stand on — an obstacle square has
      // its own dressing and stacking two props there would read as one prop.
      if (blocked.has(`${x},${y}`)) continue;
      if (r() < SCATTER_CHANCE) {
        scatter.push({ x, y, s: pick(r, isGrass ? GRASS_SCATTER : DIRT_SCATTER), f: r() < 0.5 });
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
