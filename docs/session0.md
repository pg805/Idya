# Session 0

The first time other people are in the world at the same time. Scope list and todo,
not a design doc — the reasoning lives in [`items.md`](items.md),
[`professions.md`](professions.md), [`map-ideas.md`](map-ideas.md) and
[`design-rules.md`](design-rules.md), and the constraints it has to satisfy are in
`design-rules.md`.

---

## The shape of it

Tutorial-like opening, then **the GM spawns a horde and it attacks the camp.**

That gives session 0 a beginning that teaches and an ending that everybody
experiences together, and the horde is also the economy's opening supply event —
the first metal and arcane material in the world drops off it. Combat as a faucet,
doing its actual job on day one.

## The constraint that decides everything else

**Polish is fixed. Scope is the variable.**

Nine finished chunks read better than forty-eight unfinished ones, because the
unfinished ones teach players the world is generic and they stop looking. Every item
on the todo below has to be *finished*, which is the only reason the list is this
short.

---

## In

- **Town plus ring 1** — 9 chunks. Procgen generates them; a GM pass adds points of
  interest.
- **Three professions** — Carpenter, Blacksmith, Artificer.
- **Three levels** instead of five. `CAP(L)` truncates cleanly to 50 / 125 / 225.
- **Five weapons** — sword, axe, shovel, wand, quarterstaff.
- **Four abilities** — slash, stab, chop, bash. Spells to come.
- **Axe and shovel are tools as well as weapons**; sword is a weapon only. Already
  built (`src/world/labour.ts`).
- **Rare metal and arcane drops** on enemy loot tables.
- **Multiplayer combat in the chunk**, with a round timer.
- **GM enemy spawning.**

## Out

Deferred whole, and none of it is needed to run the session:

- The real-time tick engine. A round timer covers session 0.
- Poles, the seven-number weapon, ability slots, spells.
- Mining and the pickaxe — rare drops cover the faucets instead.
- Cleric, Apothecary, Tanner.
- Zones, rings 2 and 3, the enchant rework.

---

## Todo

### Code

1. **Enemies live in chunks.** Combat currently builds its own board in
   `createSession` with random player and enemy spawns; the arena needs to be the
   chunk the players are standing in.
2. **More than one player per fight.** `sessions` is an in-memory `Map` keyed per
   player and `createSession` takes one character and one weapon. "Joining is
   entering" is unbuilt.
3. **A round timer.** Multiplayer round-based combat is where waiting bites, and one
   unsubmitted intent otherwise holds everyone in the chunk.
4. **GM enemy spawn.** The GM can place world objects (`world:place` behind
   `requireGm()`) but not enemies.
5. **Horde balance.** Every enemy in the roster is tuned for 1v1. Eight L0 enemies
   against four players is a different problem and the current sim cannot answer it.
6. **Profession rename** — Lumberjack → Carpenter, Enchanter → Artificer.
   `WEAPON_PROFESSION` in `src/economy/upgrade_service.ts` plus the upgrade and
   enchant machinery. Rides the 0.3.0 wipe, so no migration needed.
7. **Loot tables** for the metal and arcane drops.

### Art

8. **Ruins.** New decor, for the points of interest. Add to
   [`interface-art.md`](interface-art.md); the pipeline is Asset Library →
   `build-tilesets.lua` → `npm run tiles:sync`.
9. **Landmark props** generally — enough distinct things that a place is worth
   naming.

### Content, in the GM tools

10. **Walk the 9 chunks and place points of interest.** The tools are already built
    and gated (`world:paint`, `world:place`, `world:remove`). This is a content
    task, not a build task — nothing blocks starting it.
11. **Decide where enemies spawn.**
12. **Place the mine.** It holds the top-tier metal, so where it sits *is* its cost.

### Decisions still open

13. **Names for three more metals.** Talamite is the low tier, copper-like; four
    metals total.
14. **Which metal tier drops from which enemy level**, and whether the drop is the
    raw or the refined form.
15. **The spells.** Four physical abilities exist as names; the magic side has
    nothing yet.
16. **L1 stat values** for the five weapons, once it is settled whether abilities
    are multipliers on a weapon stat or carry their own magnitude.

---

## The bootstrap, which will happen ten minutes in

An axe is metal plus wood, and an axe is what gates wood. So a Carpenter cannot make
the thing that lets them gather their own material. The quarterstaff is the only
pure-wood weapon and it does not chop.

So **session 0 opens with the GM handing out axes.** `world.md` already says the GM
hands out starting gear; this is the specific reason. Worth doing deliberately rather
than discovering it live.

---

## What the session is actually testing

Not whether combat is fun and not whether the item system is elegant. One question:

> **Do players enjoy needing each other, or does it read as friction?**

Every part of this direction assumes depending on another person feels good. If it
feels like a tax to be minimised — if people route around each other, or resent being
asked — the design is wrong and no amount of tuning saves it.

The way to know is to watch one session and see whether anybody *voluntarily* asks
another player for something, and whether the person asked enjoys being asked.
