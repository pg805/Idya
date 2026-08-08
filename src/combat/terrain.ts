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

// 'g' = grass, 'd' = dirt. One char per grid CORNER, one string per row of
// corners — so this array is (height + 1) rows of (width + 1) chars, not one
// entry per square. See the note on `corners` in TerrainData.
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
  // Ground material lives on the grid's CORNERS, not on its squares. Every tile
  // the renderer draws — terrain, decor, all of it — sits on the same aligned
  // 32px grid; what varies per tile is which of its four corners are grass, and
  // that picks the shape. So a lone dirt corner isn't a dirt square, it's a
  // rounded patch straddling the four squares that meet there.
  //
  // (h + 1) rows of (w + 1) chars. corners[j][i] is the corner at the top-left
  // of square (i, j); the last row/column close off the board's far edges.
  corners: GroundRow[];
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
// exception — bare earth showing through, not terrain in its own right. Value
// noise thresholded low turns only the dips in the field into dirt.
//
// The lattice is the knob that decides what dirt LOOKS like, and it's worth more
// than the coverage number. Too fine and every dirt corner is isolated: a scatter
// of identical round dots. Around 2 squares per noise cell, corners start coming
// up dirt in short runs, which is what reads as a scuff or a worn trench.
const LATTICE = 2.0;             // squares per noise cell

// How much dirt, as a FRACTION of corners rather than a fixed noise cutoff. A
// board is only ~13x11 corners, which is a handful of noise cells, so a fixed
// cutoff swings wildly: the same constant that gave one board a few scuffs gave
// the next a clearing covering a quarter of it. Taking the lowest N of the
// board's own values pins the amount and lets the noise vary the shape, which is
// the half worth varying. The range keeps some board-to-board spread.
const DIRT_FRACTION_MIN = 0.07;
const DIRT_FRACTION_MAX = 0.15;

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
// Scatter comes in PATCHES, not an even sprinkle. Rolling each square
// independently gives a uniform dusting that reads as noise; a few clusters with
// a falloff reads as a place where things grow. One species per cluster — a
// patch of roses, a stretch of loose stones — because a mixed handful reads as
// random again.
//
// Trees are deliberately NOT clustered: where cover is matters to how a fight
// plays, so it stays uniformly random.
interface ScatterCluster {
  sprite: string;
  min: number; max: number;   // clusters of this kind per board
  radius: number;             // squares; density falls linearly to 0 here
  density: number;            // chance at the centre
  grassOnly: boolean;
}

const SCATTER_CLUSTERS: ScatterCluster[] = [
  { sprite: 'dec_flower_01', min: 1, max: 2, radius: 2.1, density: 0.85, grassOnly: true },
  { sprite: 'dec_flower_02', min: 1, max: 2, radius: 1.9, density: 0.80, grassOnly: true },
  // Pebbles spread wider and thinner — stones lying about an area rather than a
  // bed of them — and don't care what they're lying on.
  { sprite: 'dec_rock_01',   min: 1, max: 3, radius: 2.8, density: 0.45, grassOnly: false },
];

const GRASS_TUFTS = ['ov_grass_01', 'ov_grass_02', 'ov_grass_03'] as const;

const TUFT_CHANCE = 0.30;      // grass squares that get a tuft overlay

// A tree is drawn taller than the square it blocks — the trunk base sits on the
// blocked square and the rest leans up into the squares above.
//
// Trees near the top edge run off the top of the canvas and get clipped, and
// that's fine: a canopy cut off by the edge reads as forest carrying on past the
// board rather than as a mistake. (An earlier version dodged the clip by giving
// those squares a short prop instead, which just made the top row look
// deliberately bald.)
function treeStack(r: () => number): string[] {
  const top = r() < TREE_TOP_ALT_CHANCE ? TREE_TOP_ALT : TREE_TOP_MAIN;
  return r() < TREE_TALL_CHANCE
    ? [TREE_BOTTOM, pick(r, TREE_MIDS), top]
    : [TREE_BOTTOM, top];
}

// Shadows are NOT chosen here. Each shadow sprite is drawn to fit a particular
// piece of decor, so the size follows from which sprite ends up on the square —
// which isn't settled until every prop, obstacle and scatter alike, is placed.
// The renderer picks it from the sprite name (SHADOW_FOR in public/terrain.js).
//
// Forest floor: overwhelmingly trees, with the occasional bush or stump for
// low cover. An obstacle with no headroom for a tree becomes a stump rather than
// a bush — bushes are meant to stay rare, not to pile up along the top row.
function dressObstacle(r: () => number, pos: Pos): TerrainObstacleProp {
  const at = { x: pos.x, y: pos.y, f: r() < 0.5 };
  const roll = r();

  if (roll < 0.88) return { ...at, stack: treeStack(r), rubble: TREE_STUMP };
  if (roll < 0.95) return { ...at, stack: [pick(r, BUSHES)], rubble: 'dec_rock_01' };
  return { ...at, stack: [TREE_STUMP], rubble: 'dec_rock_01' };
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

  // One value per CORNER, so the lattice is one wider and one taller than the
  // board. Corner (i, j) sits at the top-left of square (i, j).
  const field: number[][] = [];
  for (let j = 0; j <= height; j++) {
    const row: number[] = [];
    for (let i = 0; i <= width; i++) row.push(noise(i, j));
    field.push(row);
  }

  // Cut at the chosen quantile of this board's own values, so the amount of dirt
  // is what we asked for and the noise only decides where it goes.
  const flat = field.flat().slice().sort((a, b) => a - b);
  const fraction = DIRT_FRACTION_MIN + r() * (DIRT_FRACTION_MAX - DIRT_FRACTION_MIN);
  const cut = flat[Math.max(0, Math.floor(flat.length * fraction) - 1)];

  const corners: GroundRow[] = field.map(row => row.map(v => (v <= cut ? 'd' : 'g')).join(''));

  // Obstacles are dressed BEFORE the loose props, because a tree occupies more
  // squares than the one it blocks: its trunk and canopy are drawn over the open
  // squares above it. Scatter has to know about those or it puts a flower where a
  // trunk will land on top of it.
  const dressed = obstacles.map(o => dressObstacle(r, o.pos));
  const underProp = new Set<string>();
  for (const p of dressed) {
    for (let i = 1; i < p.stack.length; i++) underProp.add(`${p.x},${p.y - i}`);
  }

  // A square's own look comes from its four corners; for deciding what belongs
  // on it, "is this grassy" is the majority of those four.
  const grassy: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const n = (corners[y][x] === 'g' ? 1 : 0) + (corners[y][x + 1] === 'g' ? 1 : 0)
              + (corners[y + 1][x] === 'g' ? 1 : 0) + (corners[y + 1][x + 1] === 'g' ? 1 : 0);
      row.push(n >= 3);
    }
    grassy.push(row);
  }

  // Tufts stay an even sprinkle — they're ground texture, not objects, and the
  // whole point of them is to break up flat colour everywhere.
  const overlay: TerrainProp[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grassy[y][x] && r() < TUFT_CHANCE) {
        overlay.push({ x, y, s: pick(r, GRASS_TUFTS), f: r() < 0.5 });
      }
    }
  }

  // Props only go on squares a unit can stand on — an obstacle square has its
  // own dressing and stacking two props there would read as one prop — and not
  // under the part of a tree that leans over from below.
  const free = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height
    && !blocked.has(`${x},${y}`) && !underProp.has(`${x},${y}`);

  const scatter: TerrainProp[] = [];
  const taken = new Set<string>();
  for (const c of SCATTER_CLUSTERS) {
    const n = c.min + Math.floor(r() * (c.max - c.min + 1));
    for (let i = 0; i < n; i++) {
      // The centre is a point, not a square, so a patch isn't forced to sit
      // symmetrically around one — it can lie between squares and come out lopsided.
      const cx = r() * width;
      const cy = r() * height;
      const reach = Math.ceil(c.radius);
      for (let y = Math.floor(cy) - reach; y <= Math.floor(cy) + reach; y++) {
        for (let x = Math.floor(cx) - reach; x <= Math.floor(cx) + reach; x++) {
          const k = `${x},${y}`;
          if (taken.has(k) || !free(x, y)) continue;
          if (c.grassOnly && !grassy[y][x]) continue;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d > c.radius) continue;
          if (r() >= c.density * (1 - d / c.radius)) continue;
          taken.add(k);
          scatter.push({ x, y, s: c.sprite, f: r() < 0.5 });
        }
      }
    }
  }

  return {
    seed,
    width,
    height,
    corners,
    overlay,
    scatter,
    obstacles: dressed,
  };
}
