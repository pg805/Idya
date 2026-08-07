# Painted terrain

The combat board is drawn with the pixel-art tileset from the Asset Library
(`G:\Pixel Art\Asset Library`) instead of coloured divs. Purely cosmetic in this
first pass — the engine still sees a grid of empty squares and obstacles — but
the data is shaped so terrain can earn gameplay meaning later without moving.

## The six layers

Authored as, and drawn as, six passes:

| # | Layer | What's in it |
|---|---|---|
| 1 | dirt | flat fill of `ter_dirt_full` — the base everything sits on |
| 2 | grass | `ter_grass_*` autotiled over the dirt, so dirt shows through as clearings |
| 3 | grass overlay | `ov_grass_*` tufts breaking up the flat green |
| 4 | shadows | `shadow_sm/md/lg/xl` under each prop |
| 5 | decor | scatter (flowers, rocks, reeds) + the square-level part of each obstacle |
| 6 | above decor | trunks and canopies leaning up into the squares above |

All six go onto **one canvas behind the DOM grid**. The `.cell` divs are
unchanged — they just become transparent windows onto it — which is why none of
the highlight/token/targeting code had to learn that terrain exists.

Everything is below the cells in z-order on purpose. A tree's canopy covers
squares that are *walkable*, so a unit standing under a tree, and the move or
target highlight on its square, both have to stay readable through the leaves.

## Dual-grid autotiling

The tileset gives six shapes per material — full, empty, edge, outer, inner,
diagonal. That's not six of sixteen cases with ten missing; it's every way a
material can fill the **four corners** of a tile, once rotation is allowed:

| shape | corners filled |
|---|---|
| empty | 0 |
| outer | 1 |
| edge | 2 adjacent |
| diagonal | 2 opposite |
| inner | 3 |
| full | 4 |

6 shapes x 4 rotations covers all 16 corner masks exactly.

So the drawing grid is offset **half a tile** from the board grid: each drawn
tile straddles the meeting point of four board squares, and its shape depends
only on which of those four are the material. That's why boundaries curve
through the middle of squares rather than stepping along square edges — it's
what makes the ground read as organic instead of as a staircase.

`AUTOTILE` in `public/terrain.js` builds the mask -> (shape, rotation) table at
load by rotating each base mask four times. Squares off the board clamp to the
nearest edge square, so the border reads as ground continuing rather than a cut.

## Obstacles are trees

An obstacle's **trunk base sits on the blocked square** and the rest of the tree
stacks upward into the open squares above it (`stack[i]` is drawn at `y - i`).
Those squares stay walkable; only the trunk square blocks.

The one constraint is the top edge — a tree on row 0 has nowhere to put its
canopy. Rather than clip it, an obstacle that can't fit its height falls back to
something one square tall, which incidentally lines the board's top row with
bushes, boulders and stumps.

Obstacle roll: ~62% tree (3 squares tall with headroom, else 2), 18% bush,
12% boulder, 8% stump. Trees come in a leafy and a bare-pole variant.

**Bushes are obstacles, not scatter.** They were scatter first, and it read
badly: a bush and a tree canopy are near-identical silhouettes, so a scattered
bush looked like a canopy with a missing trunk and you couldn't tell walkable
from blocked at a glance. Making them obstacles gives one clean rule — *any big
leafy mass is a square you can't enter*. Scatter is small props only.

A **destroyed** obstacle loses its canopy and shadow and becomes rubble (a stump
for a tree). That's picked client-side from live obstacle state, so the terrain
data itself never has to be regenerated mid-battle.

## Where it lives

| File | Role |
|---|---|
| `src/combat/terrain.ts` | generator — ground noise, scatter, obstacle dressing |
| `src/combat/board.ts` | `Board.terrain` (lazy) + serialization |
| `public/terrain.js` | sprite atlas, autotile table, the painter |
| `public/tiles/*.png` | the two exported sheets (`npm run tiles:sync`) |

Generation is **server-side** so every client and every reconnect sees the same
board, and so the data already sits where the rules live for when terrain starts
mattering. It's lazy (`Board.terrain` builds on first use) because the balance
sims spin up tens of thousands of boards and never draw one.

The ground mask is value noise on a coarse lattice (`LATTICE = 3.2` squares).
The lattice is deliberately bigger than one square: per-square noise autotiles
into a checkerboard of transition tiles and reads as static, not ground.

## Scale

Tiles are 32px. `--cell-size` is 48px, and the canvas backing store is an
**integer** multiple of 32 per square (`S` in `paintTerrain`) so the art is never
resampled at a fractional scale. On a 2x display that lands on an exact 3x.
Keep `--cell-size` a sensible ratio to 32 if you change it.

## Not yet used

The sheets carry more than this pass draws: dirt roads (both an area blend and a
path network), stone, sand, water, deep water and foam; fences, buildings, a
well, a chest, campfires, logs. Roads and water are the obvious next step —
water especially, since impassable terrain is the first thing that would make
the ground matter to the rules rather than just to the eye.
