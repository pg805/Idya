# Design rules

Hard constraints. Not philosophy, not vision, not a wish list. Every entry here is
a rule that can **reject a specific idea without a judgment call**, by someone who
was not in the room when it was written.

The vision lives in [`PRD.md`](PRD.md) and [`world.md`](world.md). The reasoning
behind several of these lives in [`items.md`](items.md) and
[`map-ideas.md`](map-ideas.md). This file is the short version you check against.

---

## What makes something a rule

A value does not bridge to a decision. A constraint does.

> "Cooperation is good" rejects nothing. "No activity can be unlocked by yourself"
> rejects a lot, instantly, by anyone.

So before adding anything below, run it through:

1. **Can it reject?** Phrase it so a proposal either passes or fails. If applying it
   requires re-deriving the philosophy, it is not finished.
2. **Name three ideas you like that it kills.** If you cannot name any, it is a
   slogan wearing a rule's clothes. Write the three down in the entry.
3. **Is it checkable in five seconds?** That is the point. Rules exist so design
   decisions stop costing a conversation each.

Rules can be broken deliberately. They cannot be broken accidentally, which is the
whole reason to write them down.

---

## The rules

### 1. Every activity is gated behind a tool that only one profession can craft

**Why:** It makes every activity unlock a *social event*. A new player's first
experience of the game is needing a person, which is the thing the game is trying to
teach. It also gives profession rank teeth without making the ranked player stronger.

**Test:** Can a player start doing this on their own? Then it is wrong.

**Kills:** Any activity you can just begin. Gathering with your hands. A starting
kit that includes the tool. A second profession being able to make the same tool as
a workaround.

**Note:** Gate the *activity* once, then sell the *quality* repeatedly. Tool tiers
(hoe, better hoe, best hoe, each at a higher rank) are where the recurring demand
lives; a one-time unlock is one sale.

---

### 2. Recipe cooperation escalates with level

**Why:** Interdependence should deepen as people progress, not be a one-time
tollgate at the start.

- **Level 1:** craftable from base materials alone.
- **Level 2:** requires materials crafted by someone else.
- **Level 3+:** requires more of that, and from more professions.

**Test:** Count the distinct professions a recipe depends on. If that number does not
climb with level, the recipe is at the wrong level.

**Kills:** A high-level recipe that a solo player can complete. A profession that
becomes more self-sufficient as it ranks up. Parallel recipes that route around a
dependency.

---

### 3. Combat is not the content

Combat's job is three things and none of them is being deep:

- **A faucet.** Converts time, energy and gear into materials.
- **A demand generator.** It breaks your stuff, spends your food, injures you. That
  is what makes a blacksmith, a chef and a cleric necessary rather than decorative.
- **A reason to need specific people.**

**Why:** The economy is the point, and what players should be learning is how to work
together. Tactical mastery is not the skill the game wants taught.

**Test:** Does this make combat better at being a faucet, generating demand, or
requiring other people? If it only makes combat *deeper*, it is pointed at the wrong
target.

**Kills:** Mechanical depth that a solo player masters alone. Anything whose payoff
is personal execution. (It also kills a fair amount of what is already built, which
is how you know the rule is real.)

---

### 4. Power does not live in the weapon

Effectiveness comes from armour, consumables, abilities, condition, and the people
standing next to you. The weapon contributes a few numbers and a shape.

**Why:** This is the only way *"use whatever you want and still be effective"* can be
true. While the weapon is the primary power source, the math guarantees one weapon is
best and the rest are roleplay. It also routes every stat through the economy: a
character becomes a rack of things other players made.

**Test:** If two players bring different weapons and everything else is equal, is the
gap small enough that the choice reads as taste? If not, too much power is in the
weapon.

**Kills:** Weapon damage as the dominant scaling axis. A best-in-slot weapon.
Balancing weapons against each other instead of against the whole kit.

---

### 5. Many simple levers, not few complex ones

A stat is one number with one meaning that many things can touch. Health, speed,
carry, energy, reach, and so on.

**Why:** Three goals collapse into this one requirement.

- **Authoring speed.** A new item is fast to add when it is *"+N to an existing
  stat"* or *"on X, do Y to stat Z."* Few levers means every new idea needs code.
- **Build diversity.** Everyone picks the same thing when there is one axis of power,
  because a single ordering always has a top. Incommensurable axes mean no global
  best exists.
- **Slot value.** Each equipment slot carrying a *different* stat makes gearing a set
  of real trades instead of one number in five pieces.

**Test:** Can this idea be expressed by pointing at stats that already exist? If it
needs a new subsystem, ask what stat it is really about.

**Kills:** A single "power" or "armour" number. Deep per-weapon mechanics. Any stat
whose meaning takes a paragraph.

---

### 6. Strong and narrow, never good and general

Abilities should be powerful and situational, not mild and universal.

**Why:** A thing that wins in one specific situation is healthy and creates
discovery. A thing that is merely good everywhere becomes the consensus pick within a
week. Narrowness is what makes power safe.

**Test:** Name the situation where this is *bad*. If there isn't one, it is too
general, regardless of how strong it is.

**Kills:** Flat percentage increases. Anything described as "solid in every build."
Nerfing a strong ability instead of narrowing it.

**Caveat:** Discovery is a one-time resource. Whatever players find gets shared in
chat that day. Power stays interesting only if *situations* keep changing, which is
another argument for narrow effects and for the GM being able to change conditions.

---

### 7. Progression unlocks what you can do for others

Rank unlocks what you can make *for others*, not how strong you are.

**Why:** Stated in `world.md` for professions. It generalises: personal power that
only helps you is the shape the game is trying not to have.

**Test:** Does this rank-up help anyone but the person who earned it?

**Kills:** A rank that raises your own damage or health. A capstone that is a personal
buff. Self-sufficiency as a reward.

---

### 8. Story does not affect gameplay

Lore informs flavour. It never gates, grants or modifies a mechanic.

**Why:** It is what keeps the platform a blank slate where it matters. It also
decouples the two: the lore can be rewritten without retuning the game, and the game
retuned without rewriting the lore.

**Test:** Would this mechanic still work if the setting were replaced wholesale?

**Kills:** Faction-locked abilities. Heritage or race stats. Lore-gated recipes.
Quest rewards that only make sense narratively.

**Related:** `lore/apolis.md` already runs this at the lore layer — glossary not
narrative, no goals, *"motivation belongs to the player."* `map-ideas.md` runs it on
the map: show evidence, never the answer.

---

### 9. The GM is the permanent fallback

Any role the town has not staffed, the GM covers. Any chokepoint a player monopoly
creates, the GM can relieve.

**Why:** Rule 1 makes the game a dependency graph, and a dependency graph with a
missing node is a dead game. This is the pressure valve that lets the other rules be
strict.

**Test:** If nobody on the server has this profession, can anyone still play? If not,
the GM needs a way in.

**Kills:** Any hard lock with no fallback path. Systems that assume a full roster.

---

### 10. One beat for everyone; variation lives in cooldowns

Actions do not take different amounts of time. Everyone acts on the same rhythm. What
differs between weapons and abilities is **how long a thing takes to come back**.

**Why:** It caps how much combat can become an execution skill, which rule 3 wants. It
rewards decisions over reaction speed, it is fair across latency and across players who
are not twitchy, and it never takes a player's agency away by locking them out while
something happens to them. Tempo survives as a numeric lever (cooldown length) without
a variable-duration system.

**Test:** Does this proposal make one player able to act more often than another? Then
it belongs in a cooldown, not in action duration.

**Kills:** Attack-speed stats. Animation-locked actions. Haste effects. Any weapon
described as "faster."

**The one exception:** Special has a wind-up, because interrupt needs something to bite
on. Attack and Defend resolve on the beat. That is one category-specific property, not
a speed system, and it is why the cast bar exists only on Specials.

---

### 11. Roles are axes with opposite poles, never a list of categories

There are three axes, each with two poles: **damage** (many small hits / one big hit),
**survival** (prevent / restore), **modification** (buff your side / debuff theirs).

**Why:** A pole's denial is simply the opposite pole, so prohibitions never have to be
invented and can never be vague. Grants without prohibition converge, and a hand-written
denial drifts into an adjective nobody can check. Detail in `items.md` §3.

**Test for a candidate pole:** can it attach to another pole? If a thing can be a
*support-something* or a *damage-something*, it is a **property**, not a pole. Magic
failed this test, so did ranged, so did versatile and focus.

**Kills:** A seventh role with no opposite. A denial phrased as a number rather than a
capability. Any new axis whose poles are not genuinely exclusive.

---

### 12. Permission is universal; effectiveness is not

Nothing is forbidden. The ability provides the shape, the weapon provides the number,
and a mismatch produces a legal action that accomplishes nothing.

**Why:** It is the only way *use whatever you want and still be effective* survives as
more than a slogan. It also removes an entire class of system — no tags, no class
gating, no equip restrictions, nothing to keep consistent as content grows.

**Test:** Does this proposal stop a player from doing something? Then it should be a
number that makes it bad instead.

**Kills:** Weapon-type requirements on abilities. Class-gated equipment. Any error
message of the form "you cannot use that with this." You can cast a fireball with a
battle axe; it does almost nothing, and that is the whole mechanism.

## Maybes

Not rules yet. Recorded so they are not re-derived from scratch.

- **Ally-targeted effects are stronger than self-targeted ones.** Heal yourself for
  10, heal an ally for 25. A single multiplier that teaches cooperation without a
  tutorial, and gives a clean test for any new ability. Undecided.
- **Injury has a location.** Extending the designed 0–6 injury state so a leg injury
  suppresses speed and an arm injury suppresses attack. A few simple levers rather
  than a Dwarf Fortress damage model, and it makes a cleric who treats a *specific*
  thing a specialist. Undecided.

---

## Open

- **A name for the big-hit damage pole.** "Glass cannon" names a tradeoff, not a
  playstyle. *Breaker* floated, not adopted.
- **The exact spread penalty rate.** −10% of budget per stat beyond the first is the
  working proposal; roughly 20% off a three-stat spread is the target feel.
- **Whether ability slots grow, and from what.** Weapon level is the likely answer, with
  spell access unlocking over time. Budget already scales with weapon level, so gentle
  growth avoids compounding the L1-to-L5 gap.
- **Sort the existing seventeen weapons onto the six poles.** The cheap validation,
  runnable before anything new is authored. See the test in `items.md` §3.
- **The triangle under all of this.** Deliberately set aside while the poles were worked
  out; `items.md` §4 still describes the pre-poles version.
