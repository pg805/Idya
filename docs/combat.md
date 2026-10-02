# Real-time combat

Status: **spec in progress.** Settled decisions are written as spec. Gaps are in
[Open](#open) with a proposal where one exists.

Design reasoning is in [`items.md`](items.md); constraints in
[`design-rules.md`](design-rules.md); scope for the first session in
[`session0.md`](session0.md).

Replaces the round engine: `resolveIntents` and `resolveTriangleCrits`
(`src/combat/resolution.ts`, ~880 lines), `initiative.ts`, `telegraph.ts`.

**Survives unchanged:** the grid, `board.ts`, `los.ts`, terrain, the tile layer
(types 9/10/11/13), `movement.ts` pathing.

---

## 0. How this is being built

**The base first, from scratch.** Everything below §3 was specced by merging two systems
that were never designed together — a round engine and a real-time idea — and layering an
action model on top. The layers kept needing repair because the base underneath them had
no tension in it.

So the action layer is **parked**, not deleted: Defend, Special, the triangle, resource,
armour poles, taunt and threat weighting all stay written down but none of them is settled
until the primitive is worth playing on its own.

**The primitive is: a square that moves and hits other squares, and squares that hit
back.** Nothing else.

At that level there is exactly one question, and it is not a mechanic — it is a number.
Move and act happen on the same tick (§3), so moving costs nothing and attacking costs
nothing, which means **how often you can swing** is the only thing that can make
positioning matter. Swing every tick and movement is pointless. Swing every third and the
gaps between swings become the whole game.

Being tested in a harness rather than argued about: the swing interval, three different
swing inputs (automatic, press, or hit-the-tile-you-face so that walking is aiming), reach
against theirs, and enemy count. What comes back into the spec is whatever that proves.

One early suspicion worth recording: a single enemy may not be interesting at *any* swing
interval, which would mean the base mechanic is **being outnumbered** rather than the
swing. If that holds, it points somewhere other than where §4 onward was heading.

---

## 0b. Settled by playing it

A harness lives at `public/harness/combat.html` (standalone, no server, opens from
disk). It is the reference for how this should feel, and the following came out of
playing rather than arguing.

### Bodies are continuous; the world stays a grid

**The grid is two decisions, and only one of them was wrong.** The grid as *world
structure* — terrain, autotiling, 32px art, chunk coordinates, tile effects, object
and POI placement, building — is kept exactly as it is. The grid as *unit positions*
is dropped.

This is the Stardew arrangement, which was already the stated model: tile world, free
bodies. Positions are floats in tile units, collision is circles, and units slide off
obstacles rather than sticking.

**Why the tile-position version failed**, measured rather than guessed: it stacked
three kinds of granularity — the right tile, the right tick, the right 45° wedge — and
a miss on any one produced nothing. Instrumented over a real fight, **about 18% of
clicks did anything at all**. The wedge was the worst of it, because aiming at an
*adjacent* enemy is both the commonest case and the one where a few pixels of cursor
movement swings you through three directions.

### Attacks are hitboxes

An attack is an oriented rectangle swept from the body, and **its shape is what
distinguishes weapons**: a thrust is long and thin, a swing is short and wide. On a
tile grid at reach 1 a thrust and a swing are both "the adjacent tile", so the
difference could not be expressed at all without a weapon reaching three tiles.

**Reach is measured from the body's edge, not its centre** (`sweptLength` in
`src/combat/realtime.ts`), so the rectangle actually swept is the radius plus the
reach. Two reasons. A weapon is held at the hand and reaches out from there, so
measuring from the centre let a unit's own girth eat into its reach and a fatter
enemy would have had a shorter one for free. And it is what lets the drawing tell
the truth: a weapon sprite's grip sits on the body's edge and its tip on the far
edge of the hitbox, both exactly, with the art at 1:1. The alternative was
squeezing the sprite to fit a centre-measured reach, which means drawing 32px of
art into 21px and dropping rows of pixels. Enemies are measured the same way, so
a telegraph is the length of the thing about to hit you.

### A hit shoves

Every blow pushes the body it lands on **half a square directly away from
whatever hit it** (`KNOCKBACK` in `src/combat/realtime.ts`). Away from the
attacker rather than along the aim, so being clipped by the edge of a spin
pushes you outward from the spinner, which is the direction that reads as being
hit. It applies to both sides, so an enemy's peck shoves the player too.

**It is a decaying push, not a displacement.** A hit only lines the shove up;
the movement step spends it, taking `1 - exp(-dt / KNOCKBACK_TAU)` of whatever
is left each tick, so a body leaves at about the speed of a sprint and eases
into a stop over roughly 150ms. Moving it all at once was wrong twice over: half
a square in one frame is three times a full-speed step, so it arrived as a snap,
and the body appeared to jump again when it resumed walking.

Spending it in the movement step also means it goes through the same collision
as walking, so a shove cannot post anybody through a wall or off the chunk.

**There is a ceiling on how hard a hit may shove, and it is the body's radius.**
Collision pushes a body out of the nearest face of a tile, so a single step that
carries the centre past the middle of one gets ejected out the *far* side — it
tunnels. The biggest frame of the current shove is 0.283 against a radius of
0.34, which is why a wall holds. A harder hit wants a smaller `KNOCKBACK_TAU`
spreading it over more frames, not a bigger step.

**It accumulates, and that shapes how melee plays.** Nothing pulls a target
back, so half a square a hit walks it out of a 1.34 reach in three blows. One
shove never breaks contact, so a follow-up always connects, but a player who
stands still loses the fight to their own knockback: standing lands 3 hits where
walking forward lands 23. Melee means following what you are hitting.

### Swings live in slots

A weapon carries an ordered list of swings (`MELEE` in `src/combat/melee.ts`),
and the client asks for one by **slot**: 0 is the left button, 1 the right, 2 is
Q. A weapon with fewer swings simply has fewer bound buttons — a unit ignores a
slot it does not have. A fourth ability is an entry in that list and a key
binding, nothing else.

The engine keeps the primary as a field and the rest as `extras`, because every
unit has a primary and that is what `driveEnemy` reasons about; only players
currently have more than one.

**Every timing is per swing.** A weapon's heavy attack can recover slower than
its light one, and two weapons can price the same shape differently. Nothing is
shared between swings except the sprite.

The sword's three are **deliberately identical except for `spread`** while the
feel is being judged — same damage, same window, same recovery — so the only
variable is the shape of the swing. The spin is strictly the best of the three
at these numbers. That is expected and is not a balance claim.

| Slot | Button | Swing | `spread` |
|---|---|---|---|
| 0 | left | thrust | none, holds its angle |
| 1 | right | arc | a quarter turn |
| 2 | Q | spin | the whole way round |

### Spread is the whole difference between them

`spread` is the radians a hitbox turns through while it is live. Absent means it
holds one angle, which is a thrust.

**The hitbox turns with the blade** rather than opening as the whole shape at
once, so what is drawn is still what hits. The fan is the area a swing *sweeps*,
and at reach 1 a 0.45-wide blade overlaps itself the whole way round, so it
covers solidly rather than in slices. A body at the far end of an arc is struck
late in the swing, which is the test that keeps the drawing honest.

**A swept attack snaps its aim to the nearest eighth of a circle**, so an arc
runs between compass points: centred on a cardinal it runs diagonal to diagonal,
centred on a diagonal it runs cardinal to cardinal. Those are the same rule
rather than two cases. A quarter turn spans three of the eight points. The spin
is snapped too, which decides where the turn begins, visible from its first
frame now that it starts on the aim.

**`aimAt` says where along the sweep the aimed direction falls**, 0 to 1,
defaulting to the middle.

The middle is what a short arc wants: point at something and the blade passes
through it half way, so aiming at a thing cuts it. The **start** is what a full
circle wants — centring a 360 means beginning behind yourself and only reaching
the mouse half way round, which reads as a delay before the attack arrives. The
spin uses `aimAt: 0`, so it begins on the mouse and travels round the back.

Aimed east, that is: spin `E S W N E`, arc `NE E E SE SE`.

`swingAngle` is the single definition of where a swing points at a given moment,
used by the hitbox and mirrored by the renderer. A target is struck once per
swing, so a sweep across three enemies hits each of them once.

**Right button and Q are swings only for testing.** Controls has the right
button as the shield; they carry swings for now so there is something to throw
while the feel is being judged. 250ms for a full turn is 1440 degrees a second,
which may well read as a blur — `activeMs` is the dial, and raising it lengthens
the hitbox along with the animation, because they are the same number.

### A swing commits to its aim, and is drawn for exactly as long as it hits

The hitbox is live for `activeMs`, and that is also the animation's length, so
**what is on screen is what hits**. The player thrust is 250ms, five server
ticks, which is five animation frames at one tick each.

Two things follow from making the window that long.

**The aim is committed when the swing goes live** (`swingAim` in
`src/combat/realtime.ts`). The hit test used to re-read `aim` every active tick,
which was harmless over 120ms and a spin attack over 250ms: a target is struck
once per swing, so sweeping the mouse through a circle caught everything around
you off one press. A thrust goes where it was pointed. An enemy's wind-up still
turns, because it commits on release rather than at the start, so the telegraph
stays readable right up to the moment it means something.

**The client animates off the `swing` and `tell` events, not the phase field.**
A 250ms window is five ticks but the phase field is only sampled on four: the
fifth sets itself idle before the state goes out while still running its hit
check, so a blow could land from a sword that was never drawn. An event carries
a duration, which covers the whole window and runs at the browser's frame rate
rather than the server's twenty. The phase field is still read as a backstop for
joining mid-swing or losing the event.

**The cooldown runs from the END of the active window**, so a swing's cycle is
`tellMs + activeMs + coolMs` and `coolMs` is the dial for attack rate. `activeMs`
is the animation's length, so it is not: changing it changes what you see.

Pace is roughly Hades' light attack. The player thrusts every **350ms**, 2.9 a
second; a swallow pecks every **1000ms**. The floor is the animation — a swing
cannot start until the last one finishes — so 250ms of thrust caps the player at
four a second however small the cooldown gets.

Those are measured rather than added up, and they come out one tick short of
`activeMs + coolMs`: `cool` is decremented at the top of a step and the start
check runs later in the same one, so the last cooldown tick is also the tick the
next swing begins on.

A target is struck once per swing, so **rate is damage** here. Tune the feel on
`coolMs` with that in mind, and note what it does to the enemy side too: an
enemy's `tellMs` is the whole dodge window, so speed its attacks up by closing
the dead time after one rather than by giving less warning before it.

### There is no tick the player can feel

Movement and attacks run on the frame clock; cooldowns are milliseconds. The server
will still tick and interpolate, but **nothing the player feels depends on that rate**,
which removes tick length from the design surface entirely. §2's tick spec is now a
netcode concern rather than a combat one.

### Controls

**WASD moves, the mouse aims, left click attacks, right click holds the shield, Q is
the special.** Movement and aim are separate hands, so backing away while attacking
forward is the basic move.

This is the standard top-down action scheme (Hades, Gungeon, Risk of Rain 2, Realm of
the Mad God) and using it is a feature: players arrive already knowing it. QWER is not
available because W is movement; the free keys beside WASD are Q, E, R, F, Shift and
Space.

### Generosity is a mechanic

Two fixes moved the hit rate more than any tuning:

- **Inputs buffer.** A click that arrives early is held until the attack is ready
  rather than discarded. Movement already worked this way; attacks did not, and that
  inconsistency alone was eating a quarter of all clicks.
- **Aim assist.** If nothing is under the aim but an enemy is in reach within roughly
  one wedge of where you pointed, it connects. This is what Hades does and it is not
  cheating: the player indicates, the game finishes the job.

### Tile effects still work, with one rule

A 3×3 buff tile dropped at your feet reads fine on a continuous body, but **"standing
on it" needs an exact meaning** because a circle can straddle four tiles. The rule is
**your centre point decides**. You can be visually half on a ward and getting nothing,
and that edge is felt rather than confusing.

An open fork found while testing it: **does a buff tile help whoever stands on it, or
only allies?** `world.md` says allies. But the open version makes the tile *contested
ground* — somewhere worth holding and worth pushing people off — which is the first
mechanic here that gives a fight a place rather than just a set of bodies, and it gives
the guard pole a job that is not taunt.

---

## 0c. What translates

Rough inventory against the current tree. Line counts are real.

**Survives untouched** — the large majority of the game:

| | |
|---|---|
| `combat/terrain.ts` (593) + `public/terrain.js` (668) | The harness reuses the atlas and autotile table verbatim. Zero change. |
| Tilesets, sprites, the font, `tiles:sync`, `font:build` | Art pipeline is unaffected. |
| `world/chunk.ts`, `world_service.ts`, `world/labour.ts` | Tile-shaped, and tiles stay. |
| `chat/`, presence, sockets, identity, the SPA shell | Nothing to do with combat. |
| `economy/` in full, quests, the market | Untouched. |

**Dies** (~1,400 lines):

`resolution.ts` (879), `initiative.ts` (38), `telegraph.ts` (56), `intent.ts` (13),
`disposition.ts` (12), `action_resolver.ts` (226), `src/weapon/` (459 across the
loader and twelve action classes), and all 17 weapon YAMLs.

**Rewritten, with the ideas surviving** (~2,400 lines):

| | |
|---|---|
| `movement.ts` (288) | Tile pathing becomes steering. Grid A* stays for routing between waypoints. |
| `board.ts` (198) | Tile occupancy goes; passability and obstacle queries survive in another shape. |
| `los.ts` (29) | Tile walk becomes segment-versus-box. Small. |
| `ai.ts` + `ai_planner.ts` (630) | Scoring `(destination, action, target)` per round has no meaning without rounds. Most goes; the utility idea survives at a much smaller size. |
| `combat_session.ts` (195) | There are no sessions (§1). |
| `enemy_loader.ts` (217) | New format, and smaller, since enemies use the same kit shape as players. |
| `public/game.js` (1186) | Round-based intent submission becomes continuous input. Most goes. |

**Tooling, all of it round-based** (~1,150 lines): `budget.ts`, `cost_report.ts` (157),
`simulate.ts` (142), `spatial_sim.ts` (372), `replay_sim.ts` (236), `action_value.ts`
(296). The `CAP(L)` curve survives as a number; everything that costs *per round* has to
be rebased onto time. `pacing_sim.ts` is economy and survives.

**The shape of it:** roughly 1,400 lines deleted, 2,400 rewritten, and the terrain,
world, economy, chat and identity layers — the bulk of the codebase — untouched. The
rework is deep but narrow, exactly as the game/world/infrastructure split predicted.

---

## 1. There is no combat state

The largest simplification in the design. **There is no in-combat and out-of-combat.**

Enemies are in an area. They come at you. You fight them, or you flee, or you walk
past. Stardew, not an encounter.

What that deletes outright:

- **Combat sessions.** No `CombatSession`, no in-memory `sessions` map, no session id.
- **Entering and joining.** There is nothing to join. Being there is being there.
- **The arena.** No separate board. The world is the board.
- **Loot splitting.** Enemies **drop items on the ground** and whoever picks them up has
  them. No shares, no participation accounting.
- **Leaving rules.** You can walk away at any time, because there is no state to leave.

Loot on the ground is also a social mechanic for free: who grabs what, and whether
people divide it fairly, is between the players.

## 2. The tick

**A note on the word.** "Tick" is overloaded in this project: `world.md` has a **4-hour
tick** for enemy respawn and healing, and the economy has `ShopPriceTick` and
`tickAllDue`. Bare **tick** means the combat tick everywhere in this document; the slow
one is always written **world tick**. (An earlier draft said "beat" for this to avoid the
clash — one concept, one word, and tick is the one that stays.)

- A fixed server tick of **400–500ms**. Adjustable once it can be felt.
- **The world ticks**, not a fight. Enemies act on the tick whether or not anyone is
  engaging them.
- All units act on **the same tick**. No unit acts more often than another.
- Variation between weapons and abilities lives in **cooldown length**, never in action
  duration. Nothing ever locks a player out of responding.
- Server authoritative. The client interpolates position between ticks and predicts only
  its own movement.
- Deterministic and replayable.
- The AI re-plans on a cadence of several ticks or on events, **not every tick**. Cheaper,
  and it gives enemies something like reaction time.

## 3. Movement

- **One tile per tick.** Movement is the baseline rhythm and everything else is measured
  against it.
- **You move and act on the same tick.** In real time that is the only thing that makes
  sense — there is no turn to spend.

That changes what kiting is. With equal speed you **cannot** kite: a melee enemy moving
one tile per tick stays adjacent to a player moving one tile per tick, forever. Kiting
requires being *faster*, which makes **speed the kiting stat** — and speed is a pole on
armour (§8), bought at the cost of health rather than chosen at character creation.

This is the fix for the failure recorded in `battle-ideas.md`, where range-1 enemies
essentially never land a hit on a kiting player because movement parity plus turn order
let the player retreat every turn. Real time removes the retreat window.

## 4. Actions

Three categories: **Defend, Attack, Special.** **Every ability resolves immediately.**
There are no wind-ups and no cast bars.

**Cost is what makes an ability heavy**, not time. A Special is expensive rather than
slow — the "wind-up" becomes a hole in your resource bar that takes ticks to refill. Same
rhythm, no lockout, one mechanism instead of two.

### Defend is a commitment, not a toggle

**Defending lasts 3 ticks, and you cannot attack during them.** Guarding for a single
tick was not worth doing: at 450ms the moment-to-moment value never justified the lost
output, so the option was dead.

Committing for three fixes that in both directions. It is a real trade — three ticks of
no damage — and it is *readable*, because an opponent gets a window in which they know
you are guarding and can answer with a Special.

It also settles the double-defence question: ×0.6 **and** `guard` subtracting are both
fine when defending costs three ticks of output.

### Exposure replaces the wind-up

**Proposed, not decided.** Removing wind-ups leaves the triangle's Attack-beats-Special
edge with nothing to catch — if Specials are instant, nobody is ever mid-Special.

The proposal: **a Special leaves you exposed for 2–3 ticks afterwards.** You can still
move and act; you simply take the ×1.5 from Attacks during it. Recovery rather than
telegraph — exposed *after* the blow instead of vulnerable *before* it.

That keeps all three edges, keeps abilities immediate, and never locks anyone out. What
it loses is the readable warning: an opponent can no longer see a big hit coming, only
punish it afterwards.

### The triangle

**Damage multipliers, not separate mechanics.** Your category against whatever the target
is currently in scales the roll.

| Attacker | Target's state | Multiplier |
|---|---|---|
| Attack | exposed, after a Special | **×1.5** |
| Special | guarding | **×1.5** |
| Attack | guarding | **×0.6** |
| anything | neither | ×1 |

A target in neither state is neutral, so the triangle only pays when the opponent has
actually committed to something. Exact multipliers are tuning; the shape is the decision.

**Superseded:** an earlier draft had three distinct verbs — riposte, interrupt and pierce.
Multipliers replace them.

## 5. The seven stats

A weapon is a name, a level, a resource pool, and seven numbers. Every ability names
**which stat it scales off**, and carries no magnitude of its own.

| Stat | What it does |
|---|---|
| `striker` | Rolls damage for many-small-hit melee. Slash, stab. |
| *(big-hit, **unnamed**)* | Rolls damage for one-big-hit melee. Chop, bash. |
| `magic` | Rolls damage for spells. |
| `guard` | **Subtracts** from incoming damage while Defend is held. Current block mechanics. |
| `healer` | The amount healed. |
| `support` | Scales buffs and heal-over-time. |
| `control` | Scales debuffs, damage-over-time and slows. |

**Damage is a roll, not a flat multiply.** The stat sets the roll, which keeps the
existing dice machinery and the `RollMode` weakness/resist skew
(`src/infrastructure/roll_mode.ts`) intact.

**`support` and `control` point at effects that mostly already exist.** The action types
carry over: 3 buff, 4 DOT, 5 debuff, 10 buff tile, 11 hazard tile, 13 slow tile, 14 move
debuff. Two effects are genuinely new:

- **Heal over time.** Only instant heal (type 6) exists.
- **Taunt.** Nothing in the engine does this. See threat below.

## 6. Threat

**Enemies target the nearest, and the lowest HP.** (Exact tiebreak in Open.)

**Taunt is how a guard forces attention.** Without it, "nearest and lowest HP" means a
guard cannot protect anybody — they can stand in front, but a wounded ally two tiles back
still gets picked. Taunt is therefore not flavour; it is the mechanism that makes the
`guard` pole mean anything at all.

## 7. Enemies use the same system

**By design.** An enemy is a character with a weapon, armour and abilities, running the
same seven stats and the same budget.

They may have **natural** weapons and armour — claws, hide — but those are weapons and
armour, not a parallel system. Not droppable, otherwise identical.

Consequences, all good:

- One set of balance maths governs both sides. A budget check works on an enemy.
- Authoring an enemy becomes picking a kit rather than writing action lists.
- `enemy_loader.ts` gets much smaller.

## 8. Armour

**One piece.** Not head, chest, legs, boots and pack — just **armour**, because one item
ships and five do not. The slot breakdown is a later enrichment, not a starting
requirement.

**One axis, two poles: health against speed.** Exactly the same shape as a weapon — a
budget spread along an axis, with concentrating beating spreading.

| Pole | Gives |
|---|---|
| **health** | HP |
| **speed** | movement rate |

Three things fall out of this, which is why it is worth having:

- **HP comes from armour, not from the weapon.** The weapon's `HP` field goes. That
  satisfies `design-rules.md` rule 4 and it is the answer to where health lives.
- **No permission gate anywhere.** An earlier idea had the weapon decide what armour you
  could wear, which rule 12 forbids. It is unnecessary: you cannot be armoured *and* fast
  because the points do not exist. A heavy set with a big weapon is perfectly legal — you
  are simply slow, and slow means you cannot kite and cannot disengage.
- **It is the counter to kiting.** A kiter has to buy speed, and speed is bought *with*
  health. So anyone fast enough to kite is made of paper, and one hit from a big-hit
  weapon ends them. The tactical question becomes whether they can stay out of reach, not
  whether they can survive being caught.

## 9. Resource — the fourth axis

**One resource budget, split between pool and regen.** The question is never *whether*
you have resource — everyone does, or nothing works — but **burst or sustain**.

| Pole | Gives |
|---|---|
| **pool** | a big tank: several expensive abilities back to back, then a dry spell |
| **regen** | a fast refill: cheap abilities never stop, but the big one is rare |

Same shape as the weapon's poles and armour's: a fixed budget spread along an axis, with
concentrating beating spreading. Because it is a split rather than a presence, there is no
weapon that simply cannot act.

**This settles open question 1: resource, not cooldowns.** Both limited frequency and
having both was one system too many. Resource does it with a shared pool, which keeps the
spend-and-refill rhythm the current weapons are built on, and makes a Special heavy
without making it slow.

## 10. Client

Three pieces of motion, none of them sprite animation:

- **Position tweening** between tile centres. Non-negotiable; teleporting units read as
  broken.
- **Cast bars** for Special wind-ups. A div with a width transition.
- **Hit feedback** — flash the target, pop a number, and a one-frame line from attacker to
  target so a ranged hit has a visible cause.

No attack animations, no cast poses, no projectile sprites.

---

## Open

1. ~~Resource or cooldowns~~ — **settled: resource, no cooldowns.** See §9. Cost replaces
   both the cooldown and the wind-up.

1b. **Does exposure survive?** §4 proposes it as the thing that keeps Attack-beats-Special
   alive now that wind-ups are gone. The cost is that a big hit no longer telegraphs, so
   there is no warning to read — only a punish window afterwards. If that reads badly, the
   alternative is accepting a two-state triangle (guarding or not) and dropping the third
   edge.

2. ~~Armour: gate or budget~~ — **settled: a budget, one piece, one axis.** See §8.

3. ~~Where HP comes from~~ — **settled: armour.** The weapon's `HP` field goes, which is a
   real migration since every weapon YAML sets it.

4. ~~Speed's counter~~ — **largely settled by §8:** speed is bought with health, so a
   kiter is fragile by construction. What is left is whether that alone is enough, or
   whether `control` slows and terrain also need to carry weight.

4b. **How does speed express on a discrete grid?** Movement is one tile per tick and the
   tick is uniform, so "faster" cannot mean fractional tiles. Proposal: **one tile per
   tick is the ceiling**, and weight makes you slower — heavy armour moves one tile every
   two ticks. Nobody exceeds baseline; the differential comes from the other unit being
   slow. That also means kiting works against heavy enemies and not against light ones,
   which is texture worth having.

4c. **Who makes armour in session 0?** Heavy reads as metal (Blacksmith) and light as
   leather (Tanner), but the Tanner is out of scope. So either the Blacksmith makes both,
   or armour is an assembly, or light armour waits. Affects `professions.md` open question
   5.

6. **Threat tiebreak.** "Nearest and lowest HP" needs an order — nearest first with HP as
   the tiebreak, a weighted score, or re-evaluated every few ticks. Re-evaluation cadence
   matters more than the formula: an enemy that re-picks every tick feels twitchy and
   cannot be held by a guard at all.

7. **Does the tick run everywhere?** If the world ticks rather than a fight, do enemies in
   unoccupied chunks act? Proposal: only chunks with a player present tick, and enemies
   elsewhere are stored state that catches up — which is close to what `world.md` already
   designed with its 4-hour tick.

8. **Dropped loot.** Does it persist, expire, or belong to nobody? Anyone-can-take is the
   social version and the default here, but it needs a lifetime so the ground does not
   fill up forever.

9. **Death.** Injury 0–6 on defeat is designed for a fight that ends. With no combat
   state, what happens the moment a player's HP hits zero while others keep going —
   dropped where they stand and revivable, or moved somewhere?

10. **A name for the big-hit stat.** It is the one stat that cannot be referred to.
   `breaker` floated, not adopted. Blocks ability definitions and every doc that mentions
   it.
