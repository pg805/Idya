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
