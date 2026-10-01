# Interface art plan

A working list for moving the combat interface onto the pixel-art set, and the
decisions that need making before animation starts. Counts and sizes here are
read off the current code, not estimated — see the inventory at the bottom for
where each number comes from.

Everything new goes on **mac-asset-library-64** or **mac-actor-64** — both
palettes are fair game, and both are merged into `public/palette.css` (101
colours after dedupe) by `npm run palette:sync && npm run palette:build`. The
whole site draws from those and nothing else; `npm run palette:check` fails on
any colour that is not an entry.

The shadow bake maps palette index → palette index, so an off-palette pixel
simply won't shade (`docs/terrain.md`, "Shadows are baked").

---

## 0. Scale: the interface is drawn at 2×

**Read this before drawing anything.** The Idya Pixel em is 8px and the
interface sets it at 16px, so everything on screen is at **2×**: one pixel of
the art is two CSS pixels.

Three consequences, and every one of them has already caught something:

**To get a canvas size, halve the CSS measurement.** A 16px-wide scrollbar is
**8 art pixels** of art to draw. Asking for a 16×16 canvas for it would be
drawing at 4× and it would render soft and oversized.

**Every CSS dimension has to be even.** An odd one is half an art pixel, which
is not a thing that can exist in the art. The chat box was specified as a 1px
border, which is exactly half the width of the thinnest stroke in the type
beside it — that is why it read as an odd hairline instead of a drawn line. It
is `--box-width: 2px`, one art pixel.

**Centring has to land on an even offset.** A 3px cross inside a 16px bar leaves
1.5 art pixels either side and sits visibly off-grid. The scrollbar is 14px for
this reason and no other: 7 art pixels, laid out box / gap / 3 of cross / gap /
box.

If the interface ever moves to 3×, `--box-width` is the number to change.

---

## Where the interface stands

| Already pixel art | Still CSS / Unicode | Missing entirely |
|---|---|---|
| Board terrain + decor | Status badges (7) | **Enemy sprites (12)** |
| Player tokens (23 × 32²) | Board-effect tile marks (4) | All FX |
| Idya Pixel font | HP / resource bars | Damaged-obstacle art |
| | Action panel rows + category heads | Selection / highlight tiles |
| | Cards, panels, buttons | |
| | Log glyphs (`▸ ★ ✦ ⤴ ⤵ ━━━`) | |

---

---

## The drawing queue

What is actually wanted next, in the order it unblocks something. Two pipelines,
and which one a thing takes decides where the file goes — not how it is drawn.
Everything here is **32x32**, one world tile, drawn 1:1.

| Draw | Pipeline | Lands at | Unblocks |
|---|---|---|---|
| Feather | item | `public/items/swallow_feather.png` | drops from swallows today |
| Wood | item | `public/items/sulwood.png` | the one material in scope |
| ~~Sword~~ | sprite | `public/sprites/weapon_sword_01.png` | **done** — animated, see below |
| Axe | item* | id not settled | session 0 weapon + tool |
| Shovel | item* | id not settled | session 0 weapon + tool |
| Magic big tree | world prop | Asset Library | a landmark worth naming a place after |
| Ruins | world prop | Asset Library | the first POI prop |

### Items: drop the file in, nothing else

`public/items/<item_id>.png`, 32x32. Nothing registers it and nothing rebuilds;
the id is the key in `src/economy/items.ts`. An item with no file falls back to
`_missing.png`, the magenta checkerboard, which is off-palette on purpose so an
unmade asset looks wrong rather than passable.

**\* Weapons are not items, so they go in `public/sprites/`.** Weapons are YAML
in `database/weapons/`, not `InventoryItem` rows, so `public/items/` does not
serve them. `public/sprites/<name>.png` does, through `spriteUrl()` in
`public/views/map.js`, which is the same route a character token takes — so a
weapon sprite needs no new convention and no build step. The sword is in and
drawn mid-swing; the axe and shovel land the same way.

An *inventory icon* for a weapon is a separate drawing at a separate path, and
needs the new L1 ids first (`items.md`), which are still open.

### Animation frames: `<weapon>_<n>.png`

A weapon swings through numbered frames beside its base sprite. The thrust is
five frames from **three drawings** — `1, 2, 3, 2, 1` — so it goes out and comes
back, and the retreat reads as the hand pulling in.

**Any melee weapon gets this animation for free.** To add one: draw its frames,
then add a line to `MELEE` in `src/combat/melee.ts` saying its sprite name, how
many drawings there are, and its attack shape. Nothing in the renderer or the
engine changes. The frame count drives the sequence (3 drawings make 5 steps, 5
make 9), and the length is the attack's own `activeMs`, so a heavy weapon
animates slowly without restating anything. `melee.test.ts` checks that every
frame a weapon claims actually exists as a file, so a miscounted entry fails
there rather than rendering a broken image.

| Frame | Shows |
|---|---|
| `weapon_sword_01_1.png` | the tip, just clear of the body |
| `weapon_sword_01_2.png` | out to the hilt |
| `weapon_sword_01_3.png` | the whole sword |

**The three in the repo now are placeholders, derived rather than drawn.** The
renderer maps the top of the canvas to the far end of the sweep and the bottom
to the body, so "less sword out" is the art slid down the canvas and cut off at
the top — the tip advances while the hilt is still inside the body. Frames 1 and
2 are that crop of the real sword at 11 and 22 rows (22 is exactly where the
crossguard ends, so frame 2 lands on "to the hilt"), and frame 3 is the full
drawing. They animate correctly and their cut ends are blunt, which is what
drawing them properly fixes. Overwrite any of the three; nothing needs rebuilding.

Timing is not in the art. The animation's length is the weapon's `activeMs`, so
the frames divide whatever the hitbox's live window is — 250ms and five steps
means 50ms each. A weapon with a slower swing animates slower for free.

Two rules the drawing has to follow, because the renderer depends on both:

- **It points up**, tip on the top row and grip on the bottom. The renderer
  turns "up" into the direction of the aim.
- **It spans the whole canvas.** The grip lands on the body's edge and the tip
  on the far edge of the hitbox, so padding at either end draws a weapon that
  falls short of what it hits.

A weapon with no numbered frames still swings; it just swings its single sprite,
noted once when the first frame 404s.

### The arc needs no drawings at all, yet

The sword's heavy swing is a quarter-turn arc, and its frame count is **0**,
which means the base sprite alone. That is the honest answer rather than a
shortcut: the blade is out the whole way round and its ANGLE is doing the
animating, so one drawing rotated through the arc is the whole animation.

Numbered frames for an arc would be poses *on top of* the rotation — the blade
trailing, the wrist turning over — so they compose rather than conflict. Raise
`frames` on the heavy swing when there are such poses to show, and note that a
swept swing plays `1..n` once rather than out and back, since retracing would
walk the blade backwards along its own arc.

### Getting a PNG out of a .aseprite

`python tools/aseprite_png.py <in.aseprite> <out.png> [--preview]`.

Uses Aseprite's own CLI, found in the usual Steam places or named by
`IDYA_ASEPRITE`. If it is not there, the script reads the format itself
instead — indexed or RGBA, any number of layers, stdlib only — so an export
never depends on the machine. The two agree pixel for pixel; `--pure` forces
the built-in reader, which is how that gets checked.

`--preview` prints the drawing as ASCII and lists its colours, which is how to
check a drawing without opening it, and how the sword's four were confirmed to
be palette entries.

### World props: through the Asset Library

Asset Library -> `build-tilesets.lua` -> `npm run tiles:sync`, then placed in the
world with `world:place`. Three rules the code actually enforces:

- **A sprite blocks unless its name says otherwise.** `isWalkableSprite`
  (`src/world/sprites.ts`) passes `ov_*`, `dec_flower|crop|shell|grass|reed`, and
  anything ending `_stump`. Ruins want to block, so any other `dec_`/`obj_` name
  does it.
- **Bigger than one tile means two registrations.** `SPRITE_SIZE` lives in
  `src/world/sprites.ts` *and* `public/terrain.js` — the server answers for
  collision, the client for drawing, and a size in only one of them draws a
  building you can walk through. Unlisted is 1x1. The footprint grows **upward**
  from the base tile, which is the anchor.
- **A tall thing is a stack, not a tall sprite.** `stack: [bottom, middle, top]`,
  32px each. Only `stack[0]` blocks: you walk *under* a canopy, which is why the
  upper tiles draw on `#board-canopy` above the tokens. The magic tree wants
  this; `dec_tree_01_bottom/_middle_01/_top_01` is the pattern.

### Scale, since these are the first things drawn at it

The board draws a tile at **1:1** (32 art px -> 32 CSS px at zoom 1), while the
interface chrome and font are at **2x** (see section 0). Item icons follow the
*board*, not the chrome: the same drawing has to read the same in a slot and
lying on the ground.

That is now true rather than nearly true. Chest slots were 39px, which drew a
32px icon at 1.09x and doubled every eleventh pixel; a slot is 36px so its 32px
content box holds the art exactly, and the panel is sized from the grid instead
of the other way round.

## 1. Units — the biggest gap

There is no enemy art. Every enemy on the board renders as two letters in a
circle, and `/sprites/<enemyKey>.png` (used by the Hunt page) 404s for all of
them — `hunt.js` hides the broken image with `onerror`, which is why it's never
been obvious.

| Asset | Size | Count | Notes |
|---|---|---|---|
| Enemy sprite | 32×32 | 10 | tinpul, lithkem_swallow, sulfolk, talwyrm, daefen_deer, maetoad, golnosar, child_of_sidaev, + tutorial_swallow, archive |
| Enemy sprite, 2×2 | 64×64 | 2 | melbear, sulgovenath — both already `Size: 2` in their YAML |

These serve two places at two scales: the board token (drawn at the square size,
48–64px) and the Hunt page's enemy card. A 32×32 source covers both.

**Decision needed:** do units get a **facing**? Horizontal flip is free — the
terrain painter already does it for props — so one sprite could serve both
directions if the art is drawn side-on rather than front-on.

---

## 2. Board tiles

### Board-effect tiles (the 0.2.0 positional layer)

Currently a CSS tint plus an emoji (`🛡 ⚔ ⚠ 🐌`), with the outline and label
redrawn above the canopy so trees can't hide them. Real tiles would replace all
of that.

| Kind | What it does | Emoji today |
|---|---|---|
| block | allies on it gain block each round | 🛡 |
| buff | allies on it gain attack | ⚔ |
| hazard | opposing units entering take damage | ⚠ |
| slow | leaving costs +1 movement | 🐌 |

Each needs to read as **ally or foe** — that's currently the tint colour. Either
two variants per kind (8 tiles) or one tile plus a coloured border overlay
(4 tiles + 2 borders). The second is less art and stays consistent if a third
team ever exists.

They also need a **value** printed on them (a block tile is worth N). The Idya
Pixel font at 8px can draw that over the tile, so it doesn't need to be baked in.

### Selection and highlight tiles

With the grid lines gone, these are the *only* thing showing square boundaries —
so they're now carrying more weight than when they were a wash behind a grid.

| State | Meaning |
|---|---|
| reachable | you can move here |
| reachable-contested | a unit holds it but may vacate |
| path-tile | a step on the route to your destination |
| move-target | your chosen destination |
| target-valid | in range of the selected action |
| target-selected | the tile you're aiming at |
| target-blink | a MoveTo strike will relocate you here |
| area-footprint | a square the lined-up AOE will hit |

Corner brackets and dotted outlines suit these better than filled washes — they
show the square without hiding the ground. 32×32 each, drawn as an overlay layer.

### Terrain gaps

- **Damaged obstacle.** `ObstacleState` has `intact | damaged | destroyed`, but
  nothing ever sets `damaged` and it draws identically to intact. Either art for
  a cracked/leaning tree *or* drop the state — right now it's dead weight.
- Already on the sheets, unused: dirt roads (area blend + path network), stone,
  sand, water, deep water, foam, fences, buildings, well, chest, campfires, logs,
  barrel, crab, shell, reeds, boulder. Water is the one that would change
  gameplay first.

---

## 3. Icons

Two sizes: **8×8** to sit inline with the 8px font (card badges, log lines) and
**16×16** for the action panel and anywhere with room.

| Group | Count | Items |
|---|---|---|
| Status effects | 7 | buff ▲, debuff ▼, shield ◆, reflect ↺, DOT ☠, block 🛡, move-debuff 🐌 |
| Combat stats | 3 | initiative ⚡, HP, resource |
| Action categories | 3 | defend, attack, special (+ a crit marker) |
| Action types | 14 | strike, block, buff, DOT, debuff, heal, reflect, shield, block/buff/hazard/slow tile, destroy obstacle, move debuff |
| Damage types | 3 | Arcane, Physical, Elemental |
| Damage subtypes | 14 | Blunt, Sharp, Mental, Water, Plant, Nature, Fire, Light, Force, Earth, Dark, Poison, Electric, Wind |
| Roll modes | 3 | weakness (Hd4), resist (Ld2), neutral |
| Targeting | 3 | aimed, reactive, area |

**Two decisions worth making before drawing any of these:**

- **Resources: 17 or 1?** Every weapon and enemy names its own resource — Bolts,
  Connection, Dirt, Flow, Integrity, Luck, Momentum, Noko, Pages, Poise, Resolve,
  Sharpness, Sidaev, Stamina, Strength, Tranquility, Virtue. Seventeen icons is a
  lot of drawing for something the bar and the name already communicate. One
  generic pip, or a handful shared by family, is probably enough.
- **Subtypes: 14 icons, or 3 types × colour?** Fourteen subtype icons at 8×8 will
  be hard to tell apart at a glance. The three *types* are the load-bearing
  distinction (they're what resistances key off); subtype could be a tint or a
  word.

---

## 4. UI chrome

**Most of this turned out not to need art.** The chat panel was built as the
trial run, and the frame it wanted was one pixel wide. A one-pixel box is a
line, and CSS draws lines. So do bevels (two colours), button states (a fill
swap), and a 3×3 grip (two gradient bars). Four planned assets became none.

The rule that fell out: **draw it only if CSS can't.** A frame, a bevel, a
state change and a flat mark are all cheaper and sharper as CSS, and they stay
in step with the palette automatically. Art earns its place when it carries a
*shape* — a glyph, an icon, a texture.

| Asset | Verdict |
|---|---|
| Panel frame | **Not needed.** `border: var(--box-width) solid var(--box)`, palette index 2. |
| Button | **Not needed.** Same box; idle/hover/pressed/disabled are fill and border colour. |
| Scrollbar | **Not needed.** Box for the thumb, two gradient bars for the grip. |
| Divider | **Not needed.** A 2px rule in the palette. |
| HP bar | Frame is CSS. The **fill texture** is worth drawing if it should read as more than a flat block. |
| Resource bar | Same, second colour. |
| Card frame | CSS box; a *selected* state may want a corner mark (8×8 art px). |
| Log markers | **Worth drawing** — `▸ ★ ✦ ⤴ ⤵` are shapes. 8×8 art px each. |
| Icons | **Worth drawing** — close ✕, location marker, who's-here. 8×8 art px. |

Sizes above are **art pixels**; see §0 — they render at 2×, so an 8×8 file
occupies 16 CSS px.

Still the least urgent block. Worth doing after units and tiles, when the board
no longer clashes with the frame around it.

---

## 5. FX and animation

### The prerequisite nobody's built yet

**FX are blocked on a playback layer.** A turn currently resolves server-side in
one shot and the client receives the finished state plus a log — nothing tells
the client *when* the hit landed relative to the move. Animation needs the turn
replayed as a sequence: move phase → action phase → cleanup.

The data mostly exists: `ReplayLog` / `ReplayTurn` in `combat_session.ts` already
carries per-turn `intents` with each unit's full path and its action and target.
The work is a client-side scheduler that walks that and drives the visuals,
rather than snapping to the end state.

Worth being honest that this is the expensive part — the art is the easy half.

### Moments worth animating

Ordered by how much they'd add:

| Moment | Note |
|---|---|
| Unit movement | walks its path instead of teleporting; CSS transition, no art needed |
| Strike impact | the core one; per damage *type* (3), not subtype |
| Crit | reuse impact with a flash + a bigger burst |
| Heal | |
| Block / shield absorb | needs to read as "damage stopped", distinct from a miss |
| DOT tick | small, repeats every round |
| Buff / debuff applied | |
| Reflect | damage bouncing back |
| AOE burst | scales to an N×N block — see the sizing note below |
| Tile placed | |
| Hazard triggered | fires when a unit *enters* |
| Obstacle destroyed | a tree coming down; the art already has a stump to land on |
| Blink (MoveTo) | the Nunchaku's Riptide — vanish/reappear |
| Death | |
| Floating damage numbers | Idya Pixel at 8 or 16px, no art needed |

### Decisions to lock before drawing

**Frame rate.** Author at **100ms per frame (10fps)** as the house default, but
export Aseprite's per-frame durations in the JSON and have the engine honour
them. A fixed engine constant would take timing control away from the art for no
benefit; a house default keeps things consistent when nobody's thinking about it.
Idle loops want to be slower — 200–250ms.

**Length.** 4–6 frames for a one-shot (400–600ms). That fits the beat of a
turn-based exchange, and a turn with four units resolving can't afford much more.

**Cell size and anchor.** FX cells are a **multiple of 32**, and the anchor is
the **centre of the cell aligned to the centre of the target square**. One rule,
no per-asset offsets. A 32² FX covers one square; a 64² covers a 2×2 unit or
spills a little past a single square; AOE either tiles a 32² per square or gets a
purpose-drawn 96²/160² for the common 3×3 and 5×5.

**Export.** Aseprite CLI → horizontal strip + JSON with frame tags, mirroring how
the tilesets already work. An `npm run fx:sync` alongside `tiles:sync`, and the
sheet layout owned by a script in the Asset Library the way `build-tilesets.lua`
owns the tile sheets.

**Where they render.** Add a **third canvas above the canopy** for FX, and leave
units as DOM elements. Movement animates fine as a CSS transition on the token;
impacts and bursts want a canvas. That split avoids rewriting the token,
highlight and targeting code, which all currently depend on units being cells in
a grid.

**Reduced motion.** Honour `prefers-reduced-motion`: skip to the end state,
keep the log.

---

## Suggested order

1. **Enemy sprites** (12). The only place the game shows a letter in a circle
   where art should be, and it fixes the broken Hunt page image too.
2. **Board-effect + selection tiles**. Most-seen-during-play, and the selection
   tiles are now the only thing showing the grid.
3. **Status and action icons** at 8×8/16×16. Cards and action panel.
4. **UI chrome**. Once the board no longer clashes with its frame.
5. **Playback layer**, then **FX**. Art last here, because the sequencing is the
   hard part and it determines what the FX have to hit.

---

## Inventory sources

Counts above come from: `database/enemies/*.yaml` (12 files, `Size: 2` on
melbear + sulgovenath), `public/sprites/` (23 × 32² character sprites, no enemy
keys), `ActionType` in `src/weapon/action.ts` (14), status badges and tile marks
in `public/game.js`, `.cell.*` states in `public/game.css`, `Damage_Type` /
`Damage_Subtype` across the weapon and enemy YAML (3 types, 14 subtypes in use),
`RollMode` in `src/infrastructure/roll_mode.ts` (3), and the `Resource.Name`
field across weapons and enemies (17 distinct).
