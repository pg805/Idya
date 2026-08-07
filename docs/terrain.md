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
| 2 | grass | `ter_grass_*` autotiled over the dirt, so dirt shows through as bare patches |
| 3 | grass overlay | `ov_grass_*` tufts breaking up the flat green |
| 4 | shadows | `shadow_sm/md/lg/xl` under each prop |
| 5 | decor | scatter (flowers, pebbles) + the square-level part of each obstacle |
| 6 | above decor | trunks and canopies leaning up into the squares above |

They go onto **two canvases that sandwich the DOM grid**. The `.cell` divs are
unchanged — they just become transparent windows onto the ground — which is why
none of the highlight/token/targeting code had to learn that terrain exists.

| Canvas | z | Holds |
|---|---|---|
| `#board-terrain` | below the cells | layers 1–5, everything at floor level |
| `#board-canopy` | above the tokens | layer 6, the parts of a tree that lean upward |

Layer 6 is above the tokens because that's what's physically true: a unit
standing under a tree is *behind* the leaves. Two things keep that from costing
readability, both handled in `paintTerrain`:

- **The unit's ring is redrawn on top of the canopy** (`drawTokenRing`), in the
  same colour as its CSS border, with a dark ring outside it for contrast. The
  body of the token can be lost in the foliage; where it *is* never can. Only
  units the leaves actually reach get one — a second circle on top of a token in
  the open would just look doubled.
- **Leaves lose to the UI.** Squares the player can act on this turn get the
  canopy thinned out over them (`destination-out` at 0.72), so a move or target
  highlight is never buried under a tree it happens to sit beneath. `game.js`
  collects those squares while it builds the cells and passes them down.

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
canopy, and one on row 1 only has room to be short. Rather than clip anything, an
obstacle that can't fit its height falls back to something that does.

These are forests, so obstacles are overwhelmingly trees: **~80% tree, ~13%
stump, ~7% bush**, no boulders. A tree with no headroom becomes a *stump*, not a
bush — falling through to the bush branch there would pile every top-row
obstacle into the one prop that's meant to stay rare.

The two tops and the two middles are **interchangeable parts, not two fixed tree
builds** — any top sits on any middle. Top 01 (the leafy canopy) carries 90% of
trees; top 02 (the capped bare trunk) is the occasional dead one. Height is 2 or
3 squares (~55% tall where there's room), and a 3-tall tree picks either middle
50/50.

Every prop also carries a **horizontal flip flag** — cheap variety from a small
sprite set, so a board of trees stops looking stamped. It's one flag for the
whole stack, not per sprite: flipping a trunk segment independently of the one
below it would break the tree apart down the middle.

**Bushes are obstacles, not scatter.** They were scatter first, and it read
badly: a bush and a tree canopy are near-identical silhouettes, so a scattered
bush looked like a canopy with a missing trunk and you couldn't tell walkable
from blocked at a glance. Making them obstacles gives one clean rule — *any big
leafy mass is a square you can't enter*.

Scatter is therefore small ground clutter only: **flowers and pebbles**. The
`dec_grass_*` blades are deliberately out too — the `ov_grass_*` tufts already do
that job on the overlay layer, and two kinds of loose greenery just muddies it.
`dec_rock_02` (the big boulder) is parked; `dec_rock_01` is the pebbles.

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

The ground mask is value noise, and the constants matter more than they look.
These fights happen in a **forest**, so the board is grass and dirt is the
exception — bare earth showing through, not terrain in its own right. A fine
lattice (`LATTICE = 1.4` squares) with a low threshold (`DIRT_THRESHOLD = 0.18`)
turns only the deepest dips in the field into dirt, giving ~8% coverage in small
scattered patches, most of them one or two squares across. A mid threshold on a
coarse lattice — which is where this started — produces big clearings instead,
and the board stops reading as forest.

Small patches are safe here *because* of the dual-grid autotiling: a lone dirt
square isn't drawn as a hard square of dirt, it's four corner tiles meeting,
which reads as a rounded scuff worn into the grass.

## Scale

Tiles are 32px. `--cell-size` is 48px, and the canvas backing store is an
**integer** multiple of 32 per square (`S` in `paintTerrain`) so the art is never
resampled at a fractional scale. On a 2x display that lands on an exact 3x.
Keep `--cell-size` a sensible ratio to 32 if you change it.

## Not yet used

The sheets carry more than this pass draws: dirt roads (both an area blend and a
path network), stone, sand, water, deep water and foam; fences, buildings, a
well, a chest, campfires, logs, and the `dec_rock_02` boulder (parked — it read
too heavy next to the pebbles). Roads and water are the obvious next step —
water especially, since impassable terrain is the first thing that would make
the ground matter to the rules rather than just to the eye.
