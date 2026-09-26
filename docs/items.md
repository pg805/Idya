# Items, weapons, and what a collectathon demands of combat

Status: **the 0.3.0 direction.** Parts are decided, parts are open, and each section
says which. Session 0 takes a deliberate subset of it — see
[`session0.md`](session0.md) for what is in and out.

Related: [`design-rules.md`](design-rules.md) (the constraints, in short form),
[`professions.md`](professions.md) (who owns which material),
[`session0.md`](session0.md) (the first slice), `battle-ideas.md` (AI ideas against
the *current* engine), `world.md` (the 0.3.0 world frame, now partly superseded).

---

## 1. The thesis: see a thing, want it as a weapon, have it in the game fast

The driver is **authoring speed in service of creativity.** The test is: you like the
idea of a deck of cards as a weapon, or a shovel, and it exists and works within
minutes. Swords, spears and bows too, and all of them viable, because **people should
be able to use whatever they want and still be effective.**

Item volume is a *consequence* of that, not the goal. A format cheap enough to author
on a whim produces a lot of items on its own.

Two things follow immediately, and they are the whole design:

- **Power cannot live in the weapon** (§2). While the weapon is the primary power
  source, the math guarantees one weapon is best and the rest are costume. Move power
  into armour, abilities, consumables and the people beside you, and weapon choice
  becomes expression.
- **Many simple stats, not few complex ones** (§3). A new idea is fast to add when it
  is "+N to a stat that already exists." That is only possible if there are enough
  small numbered things to point at.

The secondary effect is a **collectathon**, which is worth having. The nearest analogy
is Stardew Valley, not the farming but the shape of it: you have a character, you move
through a pixel world, you interact with things, and the things accumulate into a
catalogue you are working through.

The open world (`world.md` §17: continuous map, chunks, zones, features, one faucet
per resource) is what makes that possible. The map is the delivery mechanism for
item mass.

Everything below follows from that one commitment. The combat rework is not
motivated by combat. It is motivated by the fact that **the current weapon format
cannot scale past about twenty weapons**, and twenty is not a collectathon.

### What "legible" has to mean

With hundreds of items, a player has to be able to answer the same small set of
questions about anything they pick up, without a wiki:

- What category is it?
- What tier is it?
- Where does it come from?
- What is it *for* (equip / craft input / consume / sell / collect)?
- Does it stack?

Every item answering the same questions the same way is the whole trick. The moment
an item needs a paragraph to explain itself, the catalogue stops being browsable.

### Where the mass actually lives

Worth being honest about the ratio. Stardew has on the order of fifty weapons and
several hundred *other* items. The mass is crops, fish, forage, minerals, artifacts,
cooked dishes. Weapons are a small, legible sub-collection inside it.

Idya's equivalent mass is **materials and gathered goods**, and the player-run
market already gives them a reason to exist beyond a sell price. So:

- The collectathon lives mostly in the **gathering layer**, not the weapon layer.
- The weapon rework is not about making hundreds of weapons. It is about making
  weapons *cheap enough to author* that they can participate in item mass at all,
  instead of being seventeen bespoke hand-tuned things.

---

## 2. Why the current weapon format caps out

A weapon today is six hand-authored action lists (Defend, Defend Crit, Attack,
Attack Crit, Special, Special Crit), each entry carrying type, damage type, damage
subtype, field array, cost, range, aimed, area, rounds, and a flavour string.
`dagger.yaml` is about ninety lines. Every one of them is balanced by hand against
`cost_report.ts` and re-checked in the sims.

That is a good format for seventeen weapons that each need to feel distinct. It is
an impossible format for two hundred. Authoring cost per weapon is roughly constant
and high, and the balance surface grows with it.

### The proposed shape

A weapon becomes a name, a level, HP, a resource pool, and **seven numbers** — one
per pole, plus magic. The poles are §3.

```
striker   breaker   guard   healer   support   control   magic
```

Nothing else. No action lists, no tags, no category label. A weapon is seven numbers
and a name, which is authorable on a whim, droppable from the world, generatable in
variants, and comparable at a glance.

Power that used to live in bespoke action design now lives in **the numbers, and in
which abilities the player brings to them**.

### The obvious risk, stated plainly

If a weapon is seven numbers, weapons become fungible stat sticks and the craft tree
loses its reason to exist. The answer is the budget and the spread penalty (§3): a
weapon's numbers must add up to its level's budget, and concentrating ticks
spreading, so every weapon is a real shape rather than a strictly-better version of
a lower one. If that does not carry enough identity, this design fails. Worth
checking early rather than late.

---

## 3. The poles: ability provides shape, weapon provides number

One rule carries the whole design:

> **The ability provides the shape. The weapon provides the number.**
> **Permission is universal; effectiveness is not.**

An ability is something you know, independent of what you are holding. It says what
it does: range, area, target, cooldown, effect, and **which stat it scales off**. The
weapon says how hard it lands.

So you can cast a fireball with a battle axe. It does almost nothing, because the axe
has a magic of 2. You can equip a rapid-jab ability on that same axe, and it also does
almost nothing, because its striker is low. Nothing forbids either. The numbers
decide.

That single rule replaces every restriction the design would otherwise need. There is
no tag system, no class gating, no "you cannot channel arcana through a crossbow."
You can. It just will not work.

(An earlier draft of this doc proposed class tags — `bladed`, `heavy`, `focus` — with
abilities declaring which tags they required. That is superseded. Tags forbid; stats
discourage, and discouraging is both simpler and more in keeping with *use whatever
you want and still be effective*.)

The 0.2.0 enchant layer already does a special case of ability injection:
`buildSidaevAction` pushes Sidaev Strike into `weapon.attack` at runtime in
`applyWeaponCustomizations`. Generalising it is a cleanup, not a new mechanism.

### Three axes, six poles

Not a list of categories. **Three axes, each with two opposite poles.**

- **Damage** — *striker* (many small hits) or *the big-hit pole* (one large hit)
- **Survival** — *guard* (prevent the damage) or *healer* (undo it)
- **Modification** — *support* (your side up) or *control* (their side down)

Each pole's denial is simply the opposite pole. Striker cannot land big hits; the
big-hit pole cannot land small ones. Guard cannot heal; healer cannot guard. Support
cannot debuff; control cannot buff. Nobody has to invent a prohibition — the axis
supplies it.

Two consequences worth noting:

- **"Cannot do damage" stops being a special rule** for support and control. They are
  simply not on the damage axis.
- **Four of the six only matter when other people are there** (guard, healer, support,
  and mostly control). The cooperation thesis is the shape of the list rather than a
  rule enforced on top of it.

**The big-hit pole is unnamed.** "Glass cannon" describes a tradeoff rather than a
playstyle, so it is a placeholder. *Breaker* has been floated and not adopted.

**`focus` and `versatile` retired into this structure** rather than being solved.
Versatile turned out to be a *modifier* on a role rather than a role (you can have a
support-versatile or a damage-versatile, so it is not one of them); focus meant
single-target, which is a property that crosses all six.

### The poles are the stats

The poles are not labels attached to weapons. **They are the weapon's numbers.**

A weapon has all seven — the six poles plus magic — and its shape is which ones are
high.

- **A pure weapon** has one high number and near-zero elsewhere.
- **A starter weapon** has several low numbers, so a lone new player can function at
  all. This is deliberate and it is the on-ramp.
- **A wand** has magic high, plus whichever pole it is for.
- **A battle axe** has the big-hit pole high and magic near zero.

**Hybrids are not forbidden; they are weak.** A weapon with two mid numbers is
authorable and loses to a specialist at the specialist's job. Specialization stays
better without a rule banning hybrids, and starter weapons get to be spread-thin
without being an exception to anything. Outgrowing your starter *is* the pull toward
grouping.

### Magic is a stat, not a pole

It was considered as a fourth axis (magic vs non-magic) and it does not work, for one
specific reason: **under one-pole-per-weapon you could not be magic and a healer at
the same time.** Every combination worth having — the magic healer, the magic
controller, the magic bruiser — is exactly what a magic pole would forbid.

As a stat it does everything the pole would have, without colliding with the roles. A
healer can be a magic healer or a bandages-and-splints healer; the pole is identical
and the magic number decides which.

Ranged/melee and single/multi-target resolve the same way: **properties that cross
the poles, never poles themselves.** Any time a candidate pole can attach to another
pole, that is the tell — it is a property.

### Budget per level

A weapon's seven numbers must add up to its level's budget. **Reuse the existing
curve** rather than inventing one, since every weapon and enemy in the game is already
costed against it, and the enchant layer scales off it:

```
CAP(L) = 25 · L · (L + 3) / 2        →   50 / 125 / 225 / 350 / 500
```

`src/tools/budget.ts:10`, `src/tools/cost_report.ts:21`.

It has the property wanted: each level adds *more* than the last (+75, +100, +125,
+150 — a clean quadratic, the step growing by 25 each time) so a new level lands as a
new power tier, while the ratio flattens (2.5×, 1.8×, 1.56×, 1.43×) so L5 sits at 10×
L1 instead of running away. A steeper curve would put more of the game's total power
into the weapon and squeeze §1's "power does not live in the weapon."

**Three levels for session 0.** Progression is being overhauled and the level count
drops from five to three for the first session. The curve truncates cleanly — L1-L3 is
50 / 125 / 225 — so nothing needs rescaling, it just stops early. See
[`session0.md`](session0.md).

**Spread penalty.** Concentrating beats spreading, by design. Expressed as a
percentage so it scales itself and never needs re-tuning per level: **−10% of budget
per stat beyond the first.** One stat 100%, two 90%, three 80% — at L1 that is
50/45/40, at L5 500/450/400. The rate is not final; roughly 20% off for a
three-stat spread is the target feel.

This also collapses `cost_report.ts`'s hard job. Costing field arrays, ranges, area,
crit lists and riders becomes addition.

### The first roster

Decided, with **no stat values yet** — those get set together once it is settled
whether an ability is a multiplier on a weapon stat or carries its own magnitude
(§7, open question 6).

**Weapons:** sword, axe, shovel, wand, quarterstaff.

All five already exist in some form (`sword_wood`, `axe_wood`, `shovel_wood`,
`kustaff`, `wand`), so names and flavour carry over rather than being invented.

- **Axe and shovel are tools as well as weapons**; sword is a weapon only. Already
  true in `src/world/labour.ts`, where `CHOP_TOOLS` fells and `DIG_TOOLS` digs and
  neither does the other's job.
- **The quarterstaff is pure wood**, which makes it the one weapon a lone carpenter
  can finish, and therefore the natural starter.

**Abilities:** slash, stab, chop, bash. Slash and stab read as many-small-hits, chop
and bash as one-big-hit, so they split two and two across the damage axis. With two
non-magic slots a player carries two of the four, which is a real decision from the
first hour.

**Spells: none yet.** The magic side needs at least two or three before the same is
true there.

### Ability slots

**Four slots: two magic, two non-magic.** Fixed and symmetric.

The split being fixed means the decision is not *how many* of each, it is **which
ones** — and that moves all the weight onto what you have unlocked, found, bought or
been taught. Which is the point: it makes abilities carry the choice, and makes the
market for them live. If you could equip everything you knew, acquiring an ability
would be accumulation rather than a decision.

Swapping freely out of combat and locked once a fight starts is probably the whole
rule.

**Growth is open.** Slots probably grow with weapon level, and spell access likely
unlocks over time. One caution: budget already scales with weapon level, so if slots
do too, the two compound — going 50→500 in budget *and* 4→8 in slots is a much larger
L1-to-L5 gap than either alone. Gentle growth (4 to 6 across all five levels) keeps
that in check.

### Class-like without classes, and the test for it

The poles give what a class gives — legible identity, a clear role, a word you can
say in chat — while being a property of **what you are holding** rather than of the
character. You change role by changing gear. No character-creation commitment, no
lock-in, no respec, and someone can be a guard on Tuesday and a striker on Wednesday
because another player sold them a weapon.

It also keeps the three sources of character cleanly separate: **pole** from the
weapon, **health / speed / carry** from armour and boots and packs, and **condition**
from injury and food.

**The validation test, runnable today.** Sort the existing seventeen weapons onto the
poles.

- Two weapons land on the same pole and feel identical: one of them is redundant.
- A weapon will not sort: either it has no identity, or an axis is missing.
- Everything lands on two poles: the set is wrong.

Cheap, immediate, and it validates the scheme before anything new is authored.

### Not to be confused with guild abilities

**Guild abilities are a separate system.** Pickpocketing, and whatever else gets
applied for, are world verbs: they act on other players and on the world, they are
gated by guild membership and standing, and they have nothing to do with what you are
holding. See `world.md` on guilds gating abilities and systems.

Combat abilities are gated by weapon class. Guild abilities are gated by guild. Two
different axes, and they should stay lexically distinct in the code and the UI so
nobody has to hold both meanings of "ability" at once. Probably worth picking two
different words before either gets built.

---

## 4. Keeping the triangle

Defend > Attack > Special > Defend stays. The current *implementation* does not
survive real time (see §5): `resolveTriangleCrits` compares everyone's committed
action category within a shared round, and real time has no such moment.

But the triangle is worth keeping, and the three weapon fields are literally its
three corners, which is a good sign.

Three ways to re-express it, weakest to strongest:

**A. Stance triangle.** You hold one of three postures; your posture against theirs
sets a damage skew. This is the removed stance system wearing the triangle instead of
D/B/A. It was removed for a reason (it is a lookup table, not a read) and switching
cost is the only thing that would make it interesting. Listed for completeness.

**B. Category procs.** Every ability is categorised D/A/S. Landing an Attack on
someone whose current action is a Special fires your bonus. This is the closest port
of what exists now and it works, but it is invisible: the player cannot see why the
bonus happened.

**C. Three verbs, read off the cast bar.** Riposte on Defend-beats-Attack, interrupt on
Attack-beats-Special, pierce on Special-beats-Defend. Each edge a different mechanic
rather than one table, all three readable from a cast bar.

### Decided: B, as multipliers

**The triangle is a damage multiplier.** Your action's category against whatever the
target is currently committed to scales the roll — ×1.5 for Attack into a wind-up, ×1.5
for Special into a held guard, ×0.6 for Attack into a held guard, ×1 against a target
committed to nothing. Full table in [`combat.md`](combat.md) §4.

C is superseded. It was the more expressive option and it cost more: three separate
mechanics to build, tune and explain, where one multiplier does the job. It also made the
wind-up load-bearing, because interrupt needed something to bite on. Under multipliers the
wind-up survives on **telegraphing** instead — it is the window where an opponent reads
your commitment and answers it.

---

## 5. Real time

An open reversal: `world.md` currently states *"Combat keeps its round structure. Not
being rewritten as continuous real-time. A round timer is likely."* If this goes
ahead, that line and its open question 5 both need updating. Flagged so the two docs
do not quietly disagree.

### The argument for it is about shared space, not feel

The chunk is the arena and being in it is being in the fight. With four players and a
GM in one chunk, turn-based lockstep is a coordination problem that gets worse with
every person who joins. One unsubmitted intent holds everyone. Real time deletes the
round-timer question entirely, and it is the version where more players makes a fight
better instead of slower.

That is a platform argument, and it is the one that fits the direction in CLAUDE.md.
It is also consistent with real-time movement outside combat (`world.md` open question
3): one movement model for the whole world rather than a mode switch at the arena
boundary.

### Animation is not the blocker

Animation and real time are separable, and only one of them is required.

What real time actually needs, motion-wise:

- **Position tweening.** Lerp between tile centres instead of snapping. This is the
  only non-negotiable one, because teleporting units read as broken. It is a small
  amount of client code, not art.
- **Cast bars.** A div with a width transition. This replaces `computeTelegraph` and
  is strictly more readable than the body-language cue.
- **Hit feedback.** Flash the target, pop a number, maybe a one-frame line from
  attacker to target so a ranged hit has a visible cause.

What it does **not** need: attack animations, cast poses, projectile sprites,
per-ability art. Static sprites are fine. The counter-intuitive part is that real time
is *more* forgiving of still art than turn-based is, because nobody is staring at a
frozen frame waiting for a turn to resolve. The movement carries it.

### The shape: a fixed server tick

Not continuous physics, not sub-tile positioning. A 400 to 500ms server tick.

- The grid survives intact. Terrain, LOS, area geometry, and the tile layer (types
  9/10/11/13) port unchanged.
- Movement is one tile per N ticks; the client interpolates.
- Abilities are cooldowns measured in ticks; resource regenerates per tick.
- Deterministic and replayable, the same way rounds are today.

#### One tick for everyone, variation in cooldowns

**Decided:** actions do not take different amounts of time. Everyone acts on the same
tick. What differs is how long an ability takes to come back.

Uniform action rate costs exactly one thing: speed as a stat axis. Everything real time
was actually bought for survives it — nobody waits on anybody, movement is continuous,
and both sides act at once so prediction matters.

Tempo comes back as **cooldown length** instead. A heavy weapon's big swing recharges
over several ticks; you still act every tick, you just act with something lesser in
between. Commitment becomes *"I spent my big thing"* rather than *"I am frozen and
cannot respond."* This is the RuneScape arrangement and it is better than variable
duration for three reasons: it is one universal rhythm (the simple-levers rule),
cooldown is a clean numeric lever, and it never takes the player's agency away.

The argument that settles it: uniform timing **deliberately caps how much combat can
be an execution skill.** It rewards decisions rather than reaction speed, and it is
fair across latency and across players who are not twitchy. Given that combat is not
meant to be what players focus on mastering (`design-rules.md` rule 3), that is the
rule enforcing itself rather than a compromise.

**The one exception: Special has a wind-up.** Interrupt needs something to bite on, so
if every action resolved instantly the Attack-beats-Special edge would have no
mechanism. Attack and Defend resolve on the tick; Special telegraphs. That makes the
cast bar exist *only* on Specials, which is exactly where the drama belongs, and makes
Special a real commitment rather than a bigger number.

The AI planner should **not** run every tick. Units re-plan on a cadence (every few
ticks) or on events. That is cheaper, and it gives enemies something like reaction
time, which is a quality the current per-round planner cannot express.

### What dies

- **`resolveIntents`** (~880 lines of move phase / action phase / cleanup). Expected
  and fine.
- **`resolveTriangleCrits`** in its current form. Replaced per §4.
- **The per-round telegraph.** Replaced by cast bars, which are better.

### What it actually costs

The engine rewrite is the cheap part. **The expensive part is the tooling**, and this
is the thing that would be a nasty surprise if it were not planned for.

`budget.ts`, `cost_report.ts`, `simulate.ts`, `spatial_sim.ts` and `pacing_sim.ts` all
cost things *per round*. Every tuned number in the economy sits on top of that round
math: upgrade point values, `CAP(L)` and the enchant scaling, the fights-to-rank pacing
targets, the material throughput curve. Real time rebases all of it onto
damage-per-second and every constant gets re-derived.

`spatial_sim.ts` is the salvageable one. It already drives real boards with the real
engine, so it can step ticks instead of rounds. The constants still have to be redone.

---

## 6. Sequencing

**Decided: real time and the weapon rework land together, in session 0.**

An earlier draft of this section argued the opposite — do the ability split first on the
round engine, prove the data model, then swap the loop. That was the lower-risk order and
it is superseded, for a reason that holds: **the weapon rework is what makes combat real
time**, so splitting them means building the data model twice, once against rounds and
once against the tick. And the new map does not make sense turn-based, so shipping a
round-based session 0 on it would be shipping something already known to be wrong.

What that costs, stated honestly:

- The largest and riskiest piece of work is in front of the first session rather than
  after it.
- The balance tooling has to be rebased onto the tick before session 0 rather than at
  leisure. `budget.ts`, `cost_report.ts`, `simulate.ts`, `spatial_sim.ts` and
  `pacing_sim.ts` all cost per *round*, and every tuned economy constant sits on that
  maths.
- Players meet the untested part of the design before anyone knows whether the
  cooperation thesis holds.

The mitigation is scope, not sequence: three levels, five weapons, one wood, one metal,
three professions. See [`session0.md`](session0.md) for the cut line and the spec.

---

## 7. Open questions

1. **Do seven numbers carry enough identity?** Two weapons on the same pole at the same
   level differ only in how their remaining budget is spread. Is that enough to make
   them feel like different objects, or does the design lean on a stat-stick problem?
   The sort test in §3 answers it against the existing seventeen before anything new is
   committed.
2. **Where does the collection surface live?** A collectathon needs a visible catalogue:
   what you have seen versus what you have not. Stardew's shipping list and museum *are*
   content. Idya has nothing like it. Cheap to build (one table, one page) and probably
   load-bearing for the thesis.
3. **Does the damage-type system survive legibility?** Type times subtype multiply into a
   *roll mode* rather than a multiplier, deliberately: a weakness does not guarantee more
   damage. That opacity is a feature in a seventeen-weapon game and a liability in a
   catalogue where players compare items at a glance. Either the comparison UI has to do
   real work, or the system simplifies.
4. **How many items is "a lot"?** Fifty is a roster. Five hundred is a collectathon. The
   answer changes whether weapon variants are hand-authored or generated, and that is a
   fork worth picking deliberately.
5. **Two words for "ability".** Combat abilities (equipped in slots, scaled by the
   weapon's stats) and guild abilities (membership gated, world verbs) need distinct
   names before either is built.
6. **Tick rate.** 400 to 500ms is the guess. It is the single number that decides whether
   combat reads as tactical or as a clickfest, and it cannot be picked on paper.
