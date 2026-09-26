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

## The map

**Two places exist today:** Sulku'it (0,0) and Sulkupa Forest (1,0). `src/world/places.ts`
is a whitelist — a chunk with an entry is somewhere a player can be, and everywhere else
is unreachable. That is not a map.

### Spec: the world generates as you walk

Walk west and a new chunk exists. Walk west again and another does. **Capped at three
rings** for now, so the walkable world is chebyshev distance ≤ 3 from town — a 7×7 grid,
49 chunks. The cap is there to be felt and moved, not because 49 is correct.

- **The whitelist stops gating travel.** `exitsFrom` currently offers only neighbours
  that exist in `PLACES`; it should offer any neighbour inside the cap.
- **Nothing is stored.** `chunkSeed` already generates deterministic terrain for any
  coordinate from the world seed, so an unvisited chunk costs nothing and the same
  coordinate always produces the same ground.
- **Unauthored chunks need generated `dirt` and `obstacles`**, since those are currently
  hand-set per place. Derive them from the seed.
- **Authored places override.** Sulku'it and Sulkupa Forest keep their names, blurbs and
  hand-set knobs; `places.ts` becomes a table of *exceptions* rather than the list of
  what exists.
- **At the cap, offer no exit.** Needs a line of copy for why you cannot go further.

**This is not the change `chunk.ts` warns about.** The comment there — that neighbouring
chunks do not line up along their shared edge, and fixing it would need world-space noise
and a global dirt cut — is about **rendering neighbours side by side.** A chunk is still
viewed alone, one screen at a time, so mismatched edges are never visible. Generating on
demand is cheap; a seamless scrolling world is the expensive thing, and it is not being
asked for.

### Spec: a Place

Still four fields, now as overrides rather than the gate:

| Field | Meaning |
|---|---|
| `name` | What it is called |
| `blurb` | One line, shown on arrival |
| `dirt` | 0–1, how much bare ground. Town is 0 (built by hand), forest is 0.1 |
| `obstacles` | Roughly how many trees and rocks to scatter. Forest is 34 |

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

### 1. Combat

**Spec lives in [`combat.md`](combat.md).** In brief: a 400–500ms world tick, no
in-combat state at all, one tile per beat with move-and-act simultaneous, Defend held and
Special wound up, the riposte/interrupt/pierce triangle, threat on nearest-and-lowest-HP
with taunt, and enemies running the same seven stats and budget as players.

The largest piece is that **there is no combat session** — no arena, no joining, no loot
split. Enemies are in the world, they come at you, and they drop items on the ground.

### 2. Weapons

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

### 3. Abilities

- **The ability provides the shape. The weapon provides the number.** An ability
  declares its category, which weapon stat it scales off, range, area, aimed or
  reactive, cooldown, and wind-up if it is a Special.
- **Magnitude is a multiplier on that stat** (settled). The ability carries no damage of
  its own. Stab scales off `striker`, bash off the big-hit stat, a fireball off `magic`.
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

### 4. Enemies in the world

Enemies stop being the contents of a session and become **things standing in a chunk**.

- **`createSession` goes.** It currently builds its own board with random player and
  enemy spawns and `ENEMY_DIST_MIN/MAX`. There is no separate board any more — the chunk's
  real terrain, with its real trees as cover, is where fighting happens.
- **The `sessions` map goes.** It is keyed per player and holds one character and one
  weapon, which is the wrong shape for a world where several people are standing in the
  same place.
- **Nobody joins anything.** Being in the chunk is being in the chunk. See
  [`combat.md`](combat.md) §1.
- Enemies need persistent position and HP so they are still there when you come back,
  which is `world.md`'s "enemies as world objects."
- Defeated enemies **drop items on the ground**. Needs a ground-item concept, which does
  not exist yet.

### 5. GM spawn

The GM places enemies into a chunk the way they already place world objects
(`world:place` behind `requireGm()`). Needs a count and a roster pick, since the
session's climax is a horde rather than one enemy.

### 6. Client

Three pieces of motion, none of them sprite animation:

- **Position tweening** between tile centres. Non-negotiable; teleporting units read as
  broken.
- **Cast bars** for Special wind-ups. A div with a width transition.
- **Hit feedback** — flash the target, pop a number, and a one-frame line from attacker
  to target so a ranged hit has a visible cause.

No attack animations, no cast poses, no projectile sprites.

### 7. Data

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

### 8. Balance

**Every enemy is tuned 1v1**, and eight L0 enemies against four players is a different
problem. Neither `simulate.ts` nor `spatial_sim.ts` can evaluate it, and both are built
on rounds so they need rebasing onto the tick regardless.

The honest options are extending the sim or tuning it live. "We find out during session
0" is legitimate for a horde fight the GM is running by hand, and it may be the right
call — but it should be a choice rather than an accident.

---

## Spec questions that need answers

Numbered so they can be answered by number. Proposals given where one exists.

1. ~~Tick rate~~ — **settled: 400–500ms**, adjustable once it can be felt.
2. ~~Movement speed~~ — **settled: one tile per beat.** Movement is the baseline rhythm
   and cooldowns are measured against it.
3. ~~Ability scaling~~ — **settled: multipliers.** An ability names which weapon stat it
   scales off and all magnitude comes from the weapon. Stab reads `striker`, bash reads
   the big-hit stat.
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
11. ~~How many places~~ — **settled: the world generates as you walk, capped at 3 rings.**
    See the map spec above.
12. **Does arcane refine?** thuvel → hiruos, or thuvel alone. It is the only material
    line that could, which would make the artificer the one profession with a refining
    step.

### Combat spec questions

Moved to [`combat.md`](combat.md), which has its own Open list. Settled since this doc
was written: guard subtracts, healer scales the heal, support and control scale the
existing effect types, damage rolls rather than multiplying flat, enemies use the same
system, move and act happen together, there is no combat state, you can leave freely,
and threat is nearest-and-lowest-HP with taunt for guards.

Two of the old questions are answered for free by there being no combat state: **loot
splitting** (items drop on the ground, whoever picks them up has them) and **what ends a
fight** (nothing does — there is no fight to end).

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
