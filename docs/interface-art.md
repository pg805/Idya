# Interface art plan

A working list for moving the combat interface onto the pixel-art set, and the
decisions that need making before animation starts. Counts and sizes here are
read off the current code, not estimated — see the inventory at the bottom for
where each number comes from.

Everything new goes on **mac-asset-library-64**. The shadow bake maps palette
index → palette index, so an off-palette pixel simply won't shade
(`docs/terrain.md`, "Shadows are baked").

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

| Asset | Notes |
|---|---|
| Panel frame | 9-slice, for cards / action panel / log |
| Button | idle, hover, pressed, disabled |
| HP bar | 9-slice or tiled frame + fill; needs a damage-preview state |
| Resource bar | same, second colour |
| Card frame | combatant cards, with a selected state |
| Divider | replaces `━━━` in the log |
| Log markers | replaces `▸ ★ ✦ ⤴ ⤵` |

This is the largest block by count and the least urgent — the CSS version is
serviceable. Worth doing after units and tiles, when the board no longer clashes
with the frame around it.

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
