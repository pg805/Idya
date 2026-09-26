# Session 0

The first time other people are in the world at the same time. Scope, spec, and todo.

Design reasoning lives in [`items.md`](items.md), [`professions.md`](professions.md)
and [`map-ideas.md`](map-ideas.md); hard constraints in
[`design-rules.md`](design-rules.md). This file is what gets built and how.

**Spec convention:** where a decision is settled it is written as spec and can be built
against. Where it is not, it is listed under
[Spec questions](#spec-questions-that-need-answers) with a proposal. Nothing in a spec
section is a guess — if it is there, it was decided.

---

## The shape of it

Tutorial-like opening, then **the GM spawns a horde and it attacks the camp.**

A beginning that teaches and an ending everybody experiences together. The horde is
also the economy's opening supply event — the first talamite and thuvel in the world
drop off it, so combat does its actual job (`design-rules.md` rule 3) on day one.

## The constraint

**Polish is fixed. Scope is the variable.** Every item below has to be finished, which
is the only reason the list is this short.

---

## In

- **Real-time combat.** The round engine is replaced. This is the big one and it is in
  deliberately: the new map does not make sense turn-based.
- **The weapon and ability rework** — seven-number weapons, abilities as detachable
  objects, four slots. It comes *with* real time rather than after it.
- **Combat in the chunk**, with anyone who walks in joining.
- **GM enemy spawning.**
- **Three levels** instead of five.
- **Five weapons** — sword, axe, shovel, wand, quarterstaff.
- **Four physical abilities** — slash, stab, chop, bash — plus spells.
- **Axe and shovel are tools as well as weapons**; sword is a weapon only. Built
  (`src/world/labour.ts`).
- **Materials: sulwood and talamite**, plus thuvel if arcane is in play.
- **Three professions** — Carpenter, Blacksmith, Artificer.
- **A map with more than two places in it.**

## Out

- Mining, the pickaxe, and sielite.
- demite and domesite.
- `treated_sulwood`, `hardwood`, `alloy`, and the smelt chain.
- Cleric, Apothecary, Tanner.
- Zones, the continuous map, the enchant rework.
- A round timer. There are no rounds.

---

## The map problem

**Two places exist:** Sulku'it (0,0) and Sulkupa Forest (1,0). That is not a map.

The architecture is also not what `world.md` describes. `src/world/chunk.ts` states a
chunk is *"a DISCRETE PLACE, not a window onto a continuous world"* — you are in one at
a time and you see it alone. The terrain generator seeds its noise per board and cuts
dirt at a quantile of that board's own values, so **neighbouring chunks do not line up
along their shared edge.** The code calls making it continuous "a real change, not a
tweak," and it is out of scope.

So the map grows by **authoring places**, not by generating rings. `src/world/places.ts`
is the whitelist: a chunk with an entry is somewhere a player can be, and `exitsFrom`
connects it to whichever of its four neighbours also exist.

### Spec: adding a place

A `Place` is four fields, keyed by `'x,y'`:

| Field | Meaning |
|---|---|
| `name` | What it is called |
| `blurb` | One line, shown on arrival |
| `dirt` | 0–1, how much bare ground. Town is 0 (it is built by hand), forest is 0.1 |
| `obstacles` | Roughly how many trees and rocks to scatter. Forest is 34 |

Terrain generates from `chunkSeed` with nothing stored, so a place costs nothing until
somebody decorates it. Adding one is a four-line diff.

---

## Your todo

Art and world. None of it blocked by code.

1. **Draw ruins.** The first POI prop wanted. Add to
   [`interface-art.md`](interface-art.md); pipeline is Asset Library →
   `build-tilesets.lua` → `npm run tiles:sync`.
2. **Draw landmark props** — enough distinct things that a place is worth naming.
3. **Walk the chunks and place points of interest.** `world:paint`, `world:place` and
   `world:remove` are built and GM-gated. Content, not code.
4. **Decide where the horde comes from**, and where the mine goes even though sielite
   is out of scope — its location is a world fact worth fixing now.

Item 3 needs places to exist first. Name a number and they can be in before you start.

---

## The build

### 1. The tick

Replaces `resolveIntents` (`src/combat/resolution.ts`, ~880 lines) and
`resolveTriangleCrits`.

- A fixed server tick. All units act on **the same beat** — no unit acts more often
  than another.
- Variation between weapons and abilities lives in **cooldown length**, never in action
  duration. Nothing ever locks a player out of responding.
- Server authoritative. The client interpolates position between beats and predicts only
  its own movement.
- Deterministic and replayable, the way rounds are today.
- The AI planner re-plans on a cadence of several beats or on events, **not every
  beat**. Cheaper, and it gives enemies something like reaction time.

**Survives unchanged:** the grid, `board.ts`, `los.ts`, terrain, the tile layer (types
9/10/11/13), and `movement.ts` pathing.

### 2. Actions and the triangle

- Three action categories: **Defend, Attack, Special.**
- **Attack and Defend resolve on the beat they are issued.**
- **Special has a wind-up**, then resolves, and is interruptible for the whole wind-up.
  This is the only exception to uniform timing, and it exists because interrupt needs
  something to bite on.
- **Defend is a held state**, not a one-off action. It persists until you do something
  else.
- The triangle is three distinct mechanics rather than a damage table:

| Edge | Verb | Mechanic |
|---|---|---|
| Defend beats Attack | **riposte** | an Attack landing on a held guard fires the defender's counter |
| Attack beats Special | **interrupt** | an Attack landing on a unit mid-wind-up cancels the Special |
| Special beats Defend | **pierce** | a Special resolving into a held guard ignores it |

- A cast bar shows Special wind-ups, and it is the only cast bar, which is why it reads.

### 3. Weapons

- A weapon is a name, a level, HP, a resource pool, and **seven numbers**: `striker`,
  `breaker`, `guard`, `healer`, `support`, `control`, `magic`. Nothing else.
- The seven sum to the level budget: `CAP(L) = 25·L·(L+3)/2`, so **50 / 125 / 225** for
  L1–L3 (`src/tools/budget.ts:10`).
- **Spread penalty:** concentrating beats spreading. Working proposal is −10% of budget
  per stat beyond the first (100% / 90% / 80% → 50/45/40 at L1). Rate not final.
- Hybrids are legal and weak. Specialists win where other people are, because peak
  output is the thing that cannot be substituted.

| Weapon | Notes |
|---|---|
| quarterstaff | Pure wood, so the one weapon a lone carpenter can finish. The natural starter. |
| sword | Weapon only. |
| axe | Also the chop tool. |
| shovel | Also the dig tool. |
| wand | High `magic`. |

Stat values wait on spec question 3.

### 4. Abilities

- **The ability provides the shape. The weapon provides the number.** An ability
  declares its category, which weapon stat it scales off, range, area, aimed or
  reactive, cooldown, and wind-up if it is a Special.
- **Permission is universal; effectiveness is not.** Any ability goes in any slot on any
  weapon. A fireball on an axe is legal and does almost nothing because the axe's
  `magic` is 2. There are no equip restrictions anywhere in the system.
- **Four slots: two magic, two non-magic.** Fixed and symmetric, so the decision is
  *which* abilities rather than how many of each — which puts the weight on acquisition
  and makes abilities worth trading.
- Swapping is free out of combat, locked once a fight starts.

Physical: slash and stab scale off `striker`, chop and bash off `breaker`. Two and two,
so a player carries two of the four.

Spells: **none written yet.** Needs two or three so the magic side is a decision too.

### 5. Combat in the chunk

- The arena is **the chunk**, with its real terrain and real trees as cover. Not a
  separate generated board.
- `createSession` currently builds its own layout with random spawns and
  `ENEMY_DIST_MIN/MAX`. That goes.
- **Anyone who enters a chunk holding a live enemy joins the fight.** No hunt page, no
  session to accept.
- `sessions` is an in-memory `Map` keyed per player and `createSession` takes one
  character and one weapon. Both change.

### 6. GM spawn

The GM places enemies into a chunk the way they already place world objects
(`world:place` behind `requireGm()`). Needs a count and a roster pick, since the
session's climax is a horde rather than one enemy.

### 7. Client

Three pieces of motion, none of them sprite animation:

- **Position tweening** between tile centres. Non-negotiable; teleporting units read as
  broken.
- **Cast bars** for Special wind-ups. A div with a width transition.
- **Hit feedback** — flash the target, pop a number, and a one-frame line from attacker
  to target so a ranged hit has a visible cause.

No attack animations, no cast poses, no projectile sprites.

### 8. Data

- Cut the level system to three. `CAP(L)` truncates on its own, so this is caps and
  validation rather than maths.
- Cull materials: out go `treated_sulwood`, `hardwood`, `alloy`, the smelt chain, and
  demite / domesite / sielite. Touches recipes and shops.
- Trim to five weapons, archiving the other twelve YAMLs.
- Rebuild the recipe tree across three levels (below).
- Loot tables: talamite and thuvel on the horde.
- Profession rename, Lumberjack → Carpenter and Enchanter → Artificer.
  `WEAPON_PROFESSION` in `src/economy/upgrade_service.ts`. Rides the wipe, so no
  migration.

### 9. Balance

**Every enemy is tuned 1v1**, and eight L0 enemies against four players is a different
problem. Neither `simulate.ts` nor `spatial_sim.ts` can evaluate it, and both are built
on rounds so they need rebasing onto the tick regardless.

The honest options are extending the sim or tuning it live. "We find out during session
0" is legitimate for a horde fight the GM is running by hand, and it may be the right
call — but it should be a choice rather than an accident.

---

## Spec questions that need answers

Numbered so they can be answered by number. Proposals given where one exists.

1. **Tick rate.** Proposal: 400–500ms. The single number that decides whether combat
   reads as tactical or as a clickfest, and it cannot be picked on paper.
2. **Movement speed.** One tile per how many beats? Proposal: one tile per beat, so
   movement is the baseline rhythm everything else is measured against.
3. **Ability scaling — the blocking one.** Does an ability carry its own damage which
   the weapon stat modifies, or does it carry a *multiplier* with all magnitude coming
   from the weapon? Proposal: multipliers, which keeps abilities cheap to author.
   **This blocks every weapon stat value**, so it goes first.
4. **Resource regen.** How much per beat, and does it pause while acting?
5. **Cooldown range.** The spread between the cheapest repeatable ability and the
   heaviest. Proposal: 1 beat to roughly 8.
6. **Special wind-up length.** Fixed for all Specials or per ability? Proposal: per
   ability, 2–4 beats, since wind-up length *is* the risk.
7. **Input model.** Does a click fire on the next beat, or queue an intent that persists
   until it can fire? Proposal: queue, so a missed beat is not a lost input.
8. **Moving during a wind-up.** Cancels the Special, or can you walk while winding up?
   Proposal: cancels, because commitment should mean standing still.
9. **Loot splitting.** `world.md` says loot splits "by turns participated," which has no
   meaning without turns. Needs a new rule — time present, damage done, or an even split
   among everyone in the chunk.
10. **Death and injury in real time.** Injury 0–6 on defeat is designed, but what happens
    to a player who drops mid-fight: out until it ends, or revivable by someone carrying
    a heal?
11. **How many places** for session 0.
12. **Does arcane refine?** thuvel → hiruos, or thuvel alone. It is the only material
    line that could, which would make the artificer the one profession with a refining
    step.

---

## The bootstrap, which will happen ten minutes in

An axe is metal plus wood, and an axe is what gates wood. So a carpenter cannot make the
thing that lets them gather their own material, and the quarterstaff is the only
pure-wood weapon and it does not chop.

**Session 0 opens with the GM handing out axes.** `world.md` already says the GM hands
out starting gear; this is the specific reason. Worth doing deliberately rather than
discovering it live.

---

## Recipes across three levels

With one wood and one metal, **nothing is refined**, so rank gates *recipes* rather than
refining, and rule 2's escalation runs on cross-profession parts:

| Level | Needs | Example |
|---|---|---|
| 1 | one profession's raw material alone | quarterstaff — sulwood only |
| 2 | raw material from a second profession | axe, sword, shovel — sulwood plus talamite |
| 3 | a *crafted part* from another profession | the assembly is the point |

The five starter weapons likely span the three levels as they stand, which is worth
checking before authoring anything new.

---

## What the session is actually testing

Not whether combat is fun, and not whether the item system is elegant. One question:

> **Do players enjoy needing each other, or does it read as friction?**

Every part of this direction assumes depending on another person feels good. If it reads
as a tax to be minimised — if people route around each other, or resent being asked —
the design is wrong and no amount of tuning saves it.

The way to know is to watch one session and see whether anybody *voluntarily* asks
another player for something, and whether the person asked enjoys being asked.
