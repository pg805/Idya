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

- A fixed server tick, **400–500ms**. Adjustable once it can be felt.
- **The world ticks**, not a fight. Enemies act on the beat whether or not anyone is
  engaging them.
- All units act on **the same beat**. No unit acts more often than another.
- Variation between weapons and abilities lives in **cooldown length**, never in action
  duration. Nothing ever locks a player out of responding.
- Server authoritative. The client interpolates position between beats and predicts only
  its own movement.
- Deterministic and replayable.
- The AI re-plans on a cadence of several beats or on events, **not every beat**. Cheaper,
  and it gives enemies something like reaction time.

## 3. Movement

- **One tile per beat.** Movement is the baseline rhythm and everything else is measured
  against it.
- **You move and act on the same beat.** In real time that is the only thing that makes
  sense — there is no turn to spend.

That changes what kiting is. With equal speed you **cannot** kite: a melee enemy moving
one tile per beat stays adjacent to a player moving one tile per beat, forever. Kiting
requires being *faster*, which makes **speed the kiting stat** — and speed comes from
boots, so it is bought rather than chosen at character creation.

This is the fix for the failure recorded in `battle-ideas.md`, where range-1 enemies
essentially never land a hit on a kiting player because movement parity plus turn order
let the player retreat every turn. Real time removes the retreat window.

## 4. Actions

Three categories: **Defend, Attack, Special.**

- **Attack and Defend resolve on the beat they are issued.**
- **Special has a wind-up**, then resolves, and is interruptible for the whole wind-up.
  The only exception to uniform timing, and it exists because interrupt needs something
  to bite on.
- **Defend is a held state**, not a one-off. It persists until you do something else.
- A cast bar shows Special wind-ups. It is the only cast bar, which is why it reads.

### The triangle

Three distinct mechanics rather than a damage table:

| Edge | Verb | Mechanic |
|---|---|---|
| Defend beats Attack | **riposte** | an Attack landing on a held guard fires the defender's counter |
| Attack beats Special | **interrupt** | an Attack landing on a unit mid-wind-up cancels the Special |
| Special beats Defend | **pierce** | a Special resolving into a held guard ignores it |

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

## 8. Client

Three pieces of motion, none of them sprite animation:

- **Position tweening** between tile centres. Non-negotiable; teleporting units read as
  broken.
- **Cast bars** for Special wind-ups. A div with a width transition.
- **Hit feedback** — flash the target, pop a number, and a one-frame line from attacker to
  target so a ranged hit has a visible cause.

No attack animations, no cast poses, no projectile sprites.

---

## Open

1. **Resource or cooldowns, or both?** The current game runs on **resource only** — spend
   down, then spend an action restoring (Poise, Noko). The tick spec adds **cooldowns**.
   Those limit frequency in different ways and having both may be one system too many:

   - *Resource* is a shared pool, so it limits **total output** and creates a rhythm of
     spending and refilling.
   - *Cooldowns* are per ability, so they limit **that ability's** frequency and let a
     heavy hit be rare without touching anything else.

   Resource per level is the working idea, which makes it part of the budget. Worth
   deciding whether cooldowns also exist, because if they do, the restore-action rhythm
   that currently gives weapons their feel probably goes away.

2. ~~Armour: gate or budget~~ — **settled: a budget, one piece, one axis.** See §8.

3. ~~Where HP comes from~~ — **settled: armour.** The weapon's `HP` field goes, which is a
   real migration since every weapon YAML sets it.

4. ~~Speed's counter~~ — **largely settled by §8:** speed is bought with health, so a
   kiter is fragile by construction. What is left is whether that alone is enough, or
   whether `control` slows and terrain also need to carry weight.

4b. **How does speed express on a discrete grid?** Movement is one tile per beat and the
   beat is uniform, so "faster" cannot mean fractional tiles. Proposal: **one tile per
   beat is the ceiling**, and weight makes you slower — heavy armour moves one tile every
   two beats. Nobody exceeds baseline; the differential comes from the other unit being
   slow. That also means kiting works against heavy enemies and not against light ones,
   which is texture worth having.

4c. **Who makes armour in session 0?** Heavy reads as metal (Blacksmith) and light as
   leather (Tanner), but the Tanner is out of scope. So either the Blacksmith makes both,
   or armour is an assembly, or light armour waits. Affects `professions.md` open question
   5.

5. **Threat tiebreak.** "Nearest and lowest HP" needs an order — nearest first with HP as
   the tiebreak, a weighted score, or re-evaluated every few beats. Re-evaluation cadence
   matters more than the formula: an enemy that re-picks every beat feels twitchy and
   cannot be held by a guard at all.

6. **Does the tick run everywhere?** If the world ticks rather than a fight, do enemies in
   unoccupied chunks act? Proposal: only chunks with a player present tick, and enemies
   elsewhere are stored state that catches up — which is close to what `world.md` already
   designed with its 4-hour tick.

7. **Dropped loot.** Does it persist, expire, or belong to nobody? Anyone-can-take is the
   social version and the default here, but it needs a lifetime so the ground does not
   fill up forever.

8. **Death.** Injury 0–6 on defeat is designed for a fight that ends. With no combat
   state, what happens the moment a player's HP hits zero while others keep going —
   dropped where they stand and revivable, or moved somewhere?

9. **A name for the big-hit stat.** It is the one stat that cannot be referred to.
   `breaker` floated, not adopted. Blocks ability definitions and every doc that mentions
   it.
