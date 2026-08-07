# Painted terrain

The combat board is drawn with the pixel-art tileset from the Asset Library
(`G:\Pixel Art\Asset Library`) instead of coloured divs. Purely cosmetic in this
first pass — the engine still sees a grid of empty squares and obstacles — but
the data is shaped so terrain can earn gameplay meaning later without moving.

## One grid

**Everything is a 32px tile on one aligned grid** — terrain, decor, props, all of
it. That's how the art is authored (Aseprite tilemap layers, see
`build-tilesets.lua`), and the renderer has to match it or nothing lines up.

Worth stating plainly because the first version got it wrong. It put the ground
material on *squares* and offset the terrain grid by half a tile to make the
autotiling work. Same shapes, same maths, but the ground then sat half a square
out from the decor and hung over the board's edges. What makes the autotiling
work without that offset is putting the material on the grid's **corners**
instead — see below.

## The six layers

Authored as, and drawn as, six passes:

| # | Layer | What's in it |
|---|---|---|
| 1 | dirt | flat fill of `ter_dirt_full` — the base everything sits on |
| 2 | grass | `ter_grass_*` autotiled over it, so dirt shows through as bare patches |
| 3 | grass overlay | `ov_grass_*` tufts breaking up the flat green |
| 4 | shadows | baked into the ground beneath each prop |
| 5 | decor | scatter (flowers, pebbles) + the square-level part of each obstacle |
| 6 | above decor | trunks and canopies leaning up into the squares above |

There is deliberately **no grid layer**: no square lines, no coordinate labels.
The board is a place, not a spreadsheet, and what you can do with a square is
shown when it matters — the move and target highlights are still per-square. The
`data-coord` attribute stays on each cell as a devtools hook; nothing draws it.

They go onto **two canvases that sandwich the DOM grid**. The `.cell` divs are
unchanged — they just become transparent windows onto the ground — which is why
none of the highlight/token/targeting code had to learn that terrain exists.

| Canvas | Holds |
|---|---|
| `#board-terrain` | layers 1–5, below the cells |
| `#board-canopy` | layer 6, above the tokens |

The stacking is load-bearing and easy to get wrong — it was, once.
`#board-terrain` is the **first child** at `z-index: 0`: it shares a paint step
with the cells (both positioned, z-index 0/auto), so DOM order alone is what puts
it underneath them. `#board-canopy` is the **last child** at `z-index: 7`, above
`.combatant` (4) and `.cell.big-anchor` (6). `#board.has-terrain` carries
`isolation: isolate` so all of that resolves locally.

It first shipped with the ground layer at `z-index: -1`, which reads as "just
below" and is not. `#board` is `position: relative` with `z-index: auto`, so it
forms **no stacking context** — the negative index resolved against an ancestor
and the canvas painted *behind* `#board`'s own background. The board came out as
a flat dark fill with tree canopies floating on it and no trunk bases, since
those live on the hidden layer. Don't reintroduce a negative z-index here.

Layer 6 is above the tokens because that's what's physically true: a unit
standing under a tree is *behind* the leaves. Two things keep that from costing
readability, both in `paintTerrain`:

- **The unit's ring is redrawn on top of the canopy** (`drawTokenRing`), in the
  same colour as its CSS border, with a dark ring outside it for contrast. The
  body of the token can be lost in the foliage; where it *is* never can. Only
  units the leaves actually reach get one.
- **Leaves lose to the UI.** Squares the player can act on this turn get the
  canopy thinned out over them (`destination-out` at 0.72), so a move or target
  highlight is never buried under a tree. `game.js` collects those squares while
  it builds the cells and passes them down.

## Autotiling from the corners

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

6 shapes × 4 rotations covers all 16 corner masks exactly.

So the material lives on the grid's **corners**, and each tile is chosen by which
of its own four corners are that material. `TerrainData.corners` is therefore
`(h + 1)` rows of `(w + 1)` chars, not one entry per square. Every tile still
draws at `(x * 32, y * 32)` — aligned, no offset, nothing hanging off the edges.

A single dirt corner isn't a dirt square: it's a rounded patch straddling the
four squares that meet at that corner. Adjacent dirt corners run together into
scuffs and trenches. That's the vocabulary — dirt is a hole worn in the grass
layer, not a material painted on.

`AUTOTILE` in `public/terrain.js` builds the mask → (shape, rotation) table at
load by rotating each base mask four times.

## How much dirt

These fights happen in a forest, so the board is grass and dirt is the exception.
Two constants, and the second is subtler than it looks:

- `LATTICE = 2.0` squares per noise cell decides what dirt **looks like**. Too
  fine and every dirt corner is isolated — a scatter of identical round dots.
  Around 2, corners come up dirt in short runs, which reads as a scuff or a worn
  trench.
- `DIRT_FRACTION_MIN/MAX` (0.07–0.15) decides **how much**, as a fraction of the
  board's corners rather than a fixed noise cutoff. A board is only ~13×11
  corners — a handful of noise cells — so a fixed cutoff swings wildly: the
  constant that gave one board a few scuffs gave the next a clearing over a
  quarter of it. Cutting at a quantile of the board's own values pins the amount
  and lets the noise vary the shape, which is the half worth varying.

Result: 7–15% of corners, ~6 patches a board, median 2 corners, occasionally 6+.

## Obstacles are trees

An obstacle's **trunk base sits on the blocked square** and the rest of the tree
stacks upward into the open squares above it (`stack[i]` is drawn at `y - i`).
Those squares stay walkable; only the trunk square blocks.

Trees near the top edge run off the canvas and get clipped, and that's the point
— a canopy cut off by the edge reads as forest carrying on past the board. An
earlier version dodged the clip by giving those squares a short prop instead,
which just made the top row look deliberately bald.

Obstacles are dressed **before** the loose props, because a tree occupies more
squares than the one it blocks — scatter has to know about the squares its trunk
and canopy will cover, or it puts a flower where a trunk lands on top of it.

The mix: **~88% tree, ~7% bush, ~5% stump**, no boulders, uniform across the
board.

The two tops and the two middles are **interchangeable parts, not two fixed tree
builds** — any top sits on any middle. Top 01 (the leafy canopy) carries 90% of
trees; top 02 (the capped bare trunk) is the occasional dead one. Height is 2 or
3 squares (~55% tall), and a 3-tall tree picks either middle
50/50.

Every prop carries a **horizontal flip flag** — cheap variety from a small sprite
set. One flag for the whole stack, not per sprite: flipping a trunk segment
independently of the one below it would break the tree apart down the middle.
The flip earns its keep because the art is asymmetric — mirroring changes 33% of
the trunk base's opaque pixels, 60% of `middle_02` (the branch), ~25% of the
canopy and bushes, 100% of the small stuff. Most of that is on the **ground**
layer, so if flips ever look like they're doing nothing, suspect that layer isn't
drawing before suspecting the flag.

**Bushes are obstacles, not scatter.** They were scatter first, and it read
badly: a bush and a tree canopy are near-identical silhouettes, so a scattered
bush looked like a canopy with a missing trunk and you couldn't tell walkable
from blocked at a glance. As obstacles the rule is clean — *any big leafy mass is
a square you can't enter*.

Scatter is therefore small ground clutter only: **flowers and pebbles**. The
`dec_grass_*` blades are out too — the `ov_grass_*` tufts already do that job on
the overlay layer. `dec_rock_02` (the big boulder) is parked; `dec_rock_01` is
the pebbles.

A **destroyed** obstacle loses its canopy and becomes rubble (a stump for a
tree). That's picked client-side from live obstacle state, so the terrain data
itself never has to be regenerated mid-battle.

## Shadows are baked, and chosen last

Each shadow sprite is drawn to fit a particular piece of decor — xl for a tree
(and for a stump, which is a felled tree and the same girth), lg for a bush, md
for sunflowers, sm for a rose, none at all for pebbles since they sit flat — so
**which shadow a square gets follows from the sprite standing on it**. That can't be settled until every prop, obstacle and
scatter alike, is placed, which is why the shadow pass comes last in the
reckoning even though it draws under the decor. The map is `SHADOW_FOR` in
`public/terrain.js`, keyed by sprite name; the server carries no shadow field.

They're **baked**, ported from the Asset Library's `bake-shadows.lua`: every
pixel a shadow covers is *replaced* with the palette entry one perceptual step
below whatever ground is already there — grass in shade stays grass, dirt stays
dirt, and a shadow straddling both gets each half right. A translucent grey wash
would read as film over the art instead.

`PALETTE` (from `mac-asset-library-64.gpl`) and `SHADE` (the lua's hand-tuned
index → darker index map) are copied verbatim into `terrain.js`. **If either
changes over there, re-copy — don't re-derive.** Colours with no darker entry
(water, black) are left alone, matching the lua's fallback.

The bake runs square by square rather than over one big region: a shadow sprite
never leaves its own square, so it reads back only the squares that have one.

## Scale and sharpness

Tiles are 32px, and the canvas is sized to the board's **exact device-pixel
footprint** (`geometry()` in `terrain.js`), so the browser never rescales the
canvas after the fact. Any resampling happens once, inside `drawImage` with
smoothing off.

That matters more than it sounds. The first version sized the backing store to a
tidy multiple of 32 and let CSS scale it to fit — which on a 125%-zoom Windows
display (`devicePixelRatio` 1.25) landed on a ~1.07× rescale, the worst case
there is, and everything went to mush.

Square *boundaries* are rounded to whole device pixels, not the tile size, so
adjacent tiles always share an edge exactly — no seams, no double-drawn columns
when a square works out to a fractional number of device pixels.

`--cell-size` is 48px, and 64px at ≥1400px viewport width. 64 lands on a whole
multiple of 32 device pixels at both 1× and 2×, so pixels come out even; 48 is
sharp but with uneven pixel widths, and is the fallback where 64 would push the
battle screen past the viewport.

## Testing without a browser

`paintTerrain` is verified headlessly: stub `Image` and a 2d context that records
every call, run the real painter, then map each `drawImage` back to a sprite name
through an inverted atlas. That catches which layer a sprite landed on, which
square, mirrored or not, whether tiles align to square boundaries and tile
without gaps, and whether the shade lookup actually resolves. Worth reaching for
first — two of the bugs above were CSS/geometry mistakes that reasoning about the
code did not catch and a five-line assertion would have.

## Not yet used

The sheets carry more than this pass draws: dirt roads (both an area blend and a
path network), stone, sand, water, deep water and foam; fences, buildings, a
well, a chest, campfires, logs, and the `dec_rock_02` boulder. Roads and water
are the obvious next step — water especially, since impassable terrain is the
first thing that would make the ground matter to the rules rather than the eye.
