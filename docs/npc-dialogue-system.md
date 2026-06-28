# NPC Dialogue System — Design Spec (0.3.0)

## Goal

Give NPCs conversations that feel *somewhat alive* — closer to a D&D NPC than a
shopkeeper with one canned line. The player talks to an NPC and gets dialogue
that reacts to **who they are and what they've been doing**: their profession
ranks, what they've hunted, whether they've been losing, what they've bought,
which side they lean (empire vs. town), and how this NPC has come to feel about
them over time.

The player never free-types. Conversations are **branching choice trees**
(Baldur's Gate / Stardew style) — the NPC speaks, the player picks from a few
offered replies, the tree branches. Both the NPC's lines *and* which replies are
offered are gated by state, so the same NPC reads differently to different
players and to the same player over time.

> **Scope of this spec.** v1 is **one NPC — Dolan** — to nail the interface, the
> state model, and the "feels alive" bar before scaling out. Anything marked
> *Deferred* below is explicitly out of scope for the first build.

---

## Architecture at a glance

Three layers, cleanly separated:

1. **Authored content** — branching dialogue trees in YAML, under
   `database/dialogue/{npcId}/`. Hand-curated, but *drafted* by an LLM at author
   time (see Authoring). Not loaded by any model at runtime.
2. **State** — what the dialogue is conditioned on. For v1 this is almost
   entirely **player-relative** (this player ↔ this NPC), assembled at request
   time from data we already store plus one new relation row.
3. **Runtime** — a deterministic tree-walker. Given the current node and the
   player's pick, it filters eligible lines/options by condition, applies
   effects, and returns the next node. **No live LLM call in the player path.**

---

## Runtime is deterministic; the LLM is a writing-room tool

The dialogue a player sees is always static, reviewed YAML. The LLM's job is at
**author time**: given Dolan's character bible and a target state-bucket
("a town-leaning player who just lost three fights"), it drafts candidate lines
and replies. A human (you) approves/edits them into the YAML. Benefits:

- Nothing to latency-budget, rate-limit, or moderate in the live request path.
- Every line is reviewable and consistent with the character's voice.
- "I don't want to write it all, but I want to review it" — this is exactly that.

This replaces the old runtime-agnostic fragment-composition idea (see
*Deferred*). Fragment slots may still be used to add small variety *inside* a
single authored line (e.g. a `{playerName}` substitution or a 2-way bark pool),
but the spine of a conversation is the authored tree, not runtime recombination.

---

## State: the factor model

Everything the dialogue reacts to, assembled into one `DialogueContext` per
conversation request.

### Player-relative factors (the v1 driver)

| Factor | Source | Status |
|---|---|---|
| Profession ranks (LJ / BS / EN) | `CharacterProfession` | existing data |
| Recent hunts (which enemies, how often) | `BattleLog` (enemy, outcome) | existing data |
| Recent losses / forfeits | `BattleLog` (outcome) | existing data |
| Recent purchases | `ShopTransaction` | existing data |
| Faction lean (empire vs. town) | new player attribute, set at creation | **net-new** |
| **Opinion** (this NPC's like/dislike of this player) | `player_npc_relations` | **net-new** |
| **Familiarity** (how well they know this player) | `player_npc_relations` | **net-new** |

"Recent" is a rolling window (e.g. last N days or last N battles) computed at
request time. `EventLog` — already used for crafting/upgrade/orchard analytics —
is the natural backstop for any signal not directly queryable from the tables
above.

### Faction

A player's empire-vs-town lean is a **soft flag calculated from their actions**,
not a creation choice. Imperial-leaning behavior (imperial sinks, certain
purchases/quests) pulls it empire-ward; Sulku'it/town activity pulls it
town-ward. It settles into `empire` / `town` / `neutral`, and the dialogue reacts
to it. It's not cosmetic: it colors first impressions across *every* NPC. Dolan is
pro-Chaevul, so a town-leaning player starts on his bad side. Different NPCs filter
the *same* player action through their own politics, so opinion is never symmetric
across the cast.

> **`faction` is not `nationality`.** Nationality (Chae / Ketulvu) is *heritage*,
> already on the character. Faction (empire / town / neutral) is *allegiance*, a
> separate, **derived** value the dialogue reacts to. Dolan is the case in point:
> **Ketulvu by heritage, pro-empire by allegiance.** Independent axes.

> **Status:** the `faction` column exists and reads `neutral` for everyone until
> the action-scoring is built (deferred). The dialogue already gates on faction,
> so wiring the calculation later lights up those branches with no tree changes.

### Opinion, familiarity & standing (the relation row)

`opinion` and `familiarity` are **separate axes on purpose**. Dolan can know you
well (high familiarity) and still not like you (low opinion), or warm to you
fast without knowing you. Both gate dialogue. Opinion drifts based on what you do
and say (dialogue effects + world signals); familiarity only ever climbs with
contact. A third axis — `standing` — is the relationship *tier*, below.

```typescript
type Standing = "stranger" | "regular" | "trusted" | "confidant";

interface PlayerNPCRelation {
  characterId: string;
  npcId: string;            // "dolan"
  metBefore: boolean;
  familiarity: number;      // climbs with each conversation, never drops
  opinion: number;          // like/dislike, 0–10, drifts toward an NPC baseline
  standing: Standing;       // relationship tier — gated, can decay (see below)
  sharedHistory: string[];  // flags: ["asked_about_service", "mocked_the_empire"]
  lastSpokenAt: Date | null;
}
```

### Standing — warmth is not friendship

**Neither opinion nor familiarity alone makes you a friend** — that's `standing`,
a tier the dialogue checks directly. High opinion is *necessary but not
sufficient* for the top tier.

| Tier | Gate | Unlocks |
|---|---|---|
| `stranger` | default | the cold, functional hub |
| `regular` | met a few times, opinion not hostile | small talk; your name instead of "hunter" |
| `trusted` | high opinion + familiarity + key story flags | the war **stories** (his successes) |
| `confidant` | trusted **+ sustained**: long regular contact, hunting what he asks, top opinion | the **cracks** — his regrets, the road not taken, the truth about Fendalok |

Two rules keep friendship *rare* without an arbitrary global friend-cap (which
would unfairly lock out latecomers):

1. **The top jump is compound and behavioral.** `trusted → confidant` needs story
   progression *and* a record of doing what he wants (hunting his targets) *over
   real time* — not a number you grind.
2. **`confidant` decays.** Standing slips on neglect (stale `lastSpokenAt`,
   opinion drift). "A few close friends, not many" then emerges from *who's
   actively maintaining it* — the set stays small on its own.

The deep nodes gate on `standing: confidant`, **never on `opinion` alone** — that
gate *is* the enforcement.

### Mood — a little weather (NPC-global, fuzzes the soft gates)

A single per-NPC scalar `mood` (0–10) that **drifts on a slow tick** — mean-
reverting toward the NPC's baseline with a small random walk, the same shape as
the shop price ticks. It's **global, not per-player**: when Dolan's having a foul
day, everyone who walks in that day gets a slightly colder Dolan. It gives him
weather, and it makes the gates a little fuzzy so the same player state doesn't
always produce the same conversation.

**What it touches — deliberately only the *soft* gates:**

- Opinion comparisons evaluate against
  `effectiveOpinion = clamp₀₋₁₀(opinion + moodOffset)`, where
  `moodOffset = round((mood − baseline) × k)` with a small `k` (≈ ±1–2 at the
  extremes). So a borderline player sometimes gets the warm greeting and sometimes
  the cold one; `cold_open` vs `greet` can flip; a jab-vs-counsel fork can tip.
- `mood` is also exposed **raw** in the context, so a line/option *can* gate on it
  explicitly for flavor (`mood: "<=2"` → a grumpy bark).

**What it must NOT touch:**

- **`standing` is mood-independent.** Friendship doesn't flicker because he slept
  badly — tier promotion and the `confidant` cracks evaluate on the *real*
  relation, never on `effectiveOpinion`. Mood breathes the **warmth**, not the
  **bond**.

**Stability:** mood is **snapshotted when a conversation opens** and held for that
whole conversation — it can't shift between nodes mid-talk (that would read as a
bug). It only re-rolls *between* visits, on its tick.

**Storage:** one row per NPC (`npc_mood`: value + lastTick), or computed from a
per-NPC seed + the tick clock. Baseline is a per-NPC constant — Dolan runs cool
(baseline ~4), so his "neutral" already skews terse.

### Context object shape

```typescript
interface DialogueContext {
  // Identity / relation
  playerName: string;
  metBefore: boolean;
  familiarity: number;
  opinion: number;          // raw relation opinion
  effectiveOpinion: number; // opinion + mood offset; what opinion-gates compare against
  standing: "stranger" | "regular" | "trusted" | "confidant";  // mood-independent
  mood: number;             // NPC-global, snapshotted at conversation open
  sharedHistory: string[];
  faction: "empire" | "town" | "neutral";

  // Derived player signals (rolling window)
  professionRanks: { lumberjack: number; blacksmith: number; enchanter: number };
  recentHunts: string[];        // enemy ids hunted recently
  recentLosses: number;         // losses/forfeits in window
  recentPurchases: string[];    // item ids bought recently

  // Time
  daysSinceLastVisit: number | null;
}
```

---

## Conversation tree format

One file per conversation surface, under `database/dialogue/{npcId}/`. A file
declares an **entry** (which node to open on, first matching condition wins) and
a map of **nodes**. A node has the NPC's line(s) and the player's options.

```yaml
# database/dialogue/dolan/general_store.yaml
npc: dolan

# First entry whose conditions pass becomes the opening node.
entry:
  - node: first_meeting
    conditions: { metBefore: false }
  - node: cold_open
    conditions: { opinion: "<=3" }
  - node: greet
    conditions: {}                       # fallback

nodes:
  greet:
    # NPC line: a single string, or a weighted/conditioned pool (first eligible
    # wins unless multiple are eligible, then weighted-random).
    say:
      - text: "{playerName}. What do you need?"
        conditions: { opinion: ">=6" }
      - text: "Back again. Buying, or loitering?"
        conditions: { opinion: "<6" }
      - text: "Take a look around."          # always-eligible fallback
    # Player choices, top-to-bottom; only eligible ones are shown.
    options:
      - text: "You served in the Fifth, I heard."
        conditions: { sharedHistory: excludes asked_about_service }
        effects: { familiarity: +1, flag: asked_about_service }
        goto: service_story
      - text: "That swallow permit's already paying off."
        conditions: { recentPurchases: includes swallow_bait }
        effects: { opinion: +1 }
        goto: shop_smalltalk
      - text: "The empire's boots are too heavy for a town this size."
        conditions: { faction: town }
        effects: { opinion: -1, flag: mocked_the_empire }
        goto: empire_rebuke
      - text: "Nothing. Leaving."
        goto: end

  service_story:
    say:
      - text: "Twenty-six years. Officer, Fifth Division. You don't get that
               standing around Sulku'it."
    options:
      - text: "Why come back, then?"
        conditions: { sharedHistory: excludes asked_why_back }
        effects: { familiarity: +1, flag: asked_why_back }
        goto: why_back
      - text: "Hm."
        goto: greet            # loop back to the hub node
```

### Node mechanics

- **`say`** — the NPC's line(s). String or a list of `{ text, conditions?, weight? }`.
- **`options`** — player replies. Each: `text`, optional `conditions`,
  optional `effects`, and `goto` (another node id, or `end`).
- **`effects`** — `opinion: ±N`, `familiarity: ±N`, `flag: name` (push onto
  `sharedHistory`). Applied when the option is chosen, before navigating.
- **`goto: end`** — closes the conversation. Terse NPCs (Dolan) should have
  short trees with frequent `end`s; that *is* the characterization.
- **Loops** — `goto` back to a hub node lets a conversation fan out and return.
  Options already-taken are gated off via `sharedHistory: excludes …`.
- **`optionsFrom: <nodeId>`** — a node borrows another node's option menu. Used by
  the return **hub** to reuse the opener's (`greet`'s) menu without duplicating it.
- **`topic: <label>`** — tags a node. When you leave it, the next node sees
  `lastTopic: <label>` in context. The hub's `say` conditions on `lastTopic` so the
  **continuation evolves from what was just said** (cooled after `politics`, guarded
  after `confided`, near-warm after `service`) rather than a fixed bridge line.
- **`say` priority tiers** (in `pickSay`): a line that conditions on `lastTopic`
  wins first; then other conditioned lines (mood/standing colour); then
  unconditioned fallbacks. So the topic reaction beats the generic prompt, and the
  generic prompt beats nothing.

### Condition syntax

Conditions are key→value pairs over the `DialogueContext`; **all must pass**.
An option/line with no conditions is always eligible (the fallback).

| Form | Example | Meaning |
|---|---|---|
| `key: value` | `metBefore: true` | exact match |
| `key: enum` | `faction: town`, `standing: confidant` | enum match |
| `key: ">=N"` | `familiarity: ">=3"` | numeric compare |
| `key: "<=N"` / `"<N"` / `">N"` | `opinion: "<=3"` | numeric compare |
| `key: includes v` | `recentHunts: includes talwyrm` | array contains |
| `key: excludes v` | `sharedHistory: excludes asked_about_service` | array lacks |

No scripting language — if a condition needs more than this, it's a sign the
state should expose a new derived field instead.

Multiple stance-flags at once (what callbacks need):

```yaml
conditions: { flags: { defended_town: true, mocked_service: false } }
```

---

## Tension, alignment, and staying in it

A real conversation isn't a path to the exit — it's a topic *circled* until
someone releases it. Two layers make that happen.

### Conversation-local tension (`heat`, and its warm twin)

`heat` is **conversation-local** state — it accumulates across turns, is **not**
persisted, and round-trips with the client (`NodeView.convo`). It models the
charge of an *argument*: pressing raises it, lines sharpen with it, and it only
drops when you concede, change the subject, or the NPC ends it. The loop's
gravity is *staying in*, not leaving.

The **same mechanic, opposite valence**, gives the warm mode: a `warmth`/rapport
counter that rises as you draw him out (asking, listening), which he likes you
for. Both are just conversation-local counters; the loop pattern is
topic-agnostic. *(heat is built; warmth is the planned symmetric twin.)*

### The loop pattern (any topic, two modes)

- A **loop node** whose `say` tiers on the counter (measured → pointed → cutting,
  or cordial → open → confiding), and whose options are *several ways to press
  the same point* — they don't drain, you circle.
- **Release valves are always present** (lint enforces escapability): concede,
  change subject, walk away.
- **The NPC offers outs too.** At high `heat` he forces the door; in a warm loop
  he can offer a graceful exit ("that is enough of that"). Release isn't only the
  player's to call.

### Alignment shifts per choice, and tension settles into it

Opinion moves a *little* on most choices — his read of you, decision by decision.
On top of that, when a loop **releases**, the accumulated tension **settles into
a lasting opinion delta by how it went**: a hot argument you conceded with grace
nets positive; a nasty one you stormed out of, negative; a long warm engagement,
positive. Ephemeral `heat` leaves a permanent mark proportional to its conduct.
*(per-choice nudges are live; the settle-up is the next engine step.)*

---

## Verifying an interconnected system

This is complicated **by design**, so you don't verify it by enumerating paths
(combinatorial, and "correct" isn't even well-defined for emergent content). You
assert **invariants** and **properties over random walks** — `npm run
dialogue:lint` (`src/tools/dialogue_lint.ts`):

- **Static invariants:** every `goto` resolves; every node is reachable from an
  entry; **every node can reach an exit** (no loop ever traps you); no node has
  zero options.
- **Fuzz:** thousands of random conversations under randomized state, applying
  the real heat/flag/opinion effects, asserting: never stuck, always terminates
  (a release is always reachable *and* gets taken), state stays in bounds.

The *feel* is verified by playing; the *system* is verified by these. Run the
lint on every content change — a new loop that can't be escaped, or a flag typo
that strands a branch, fails it immediately.

### Documenting it

The **YAML is the source of truth** — don't hand-maintain a second description
of the graph; it rots. Document the **rules**, not the wiring: the axes (opinion,
familiarity, standing, mood, heat, faction) and what moves them; the **flag
vocabulary** (stance flags and their meaning); the conventions (loops always
offer an out; aggressive +heat, concede −heat; release settles into opinion).
Views *over* the graph (a visualizer, a flag-registry extractor) should be
**generated** from the YAML, never kept in sync by hand.

---

## Interface

The live system is the web SPA, so the conversation UI is web. Dolan already has
a home: **The Fifth Regiment General Store** page. v1 adds a **Talk** affordance
there that opens a conversation panel — the NPC's line, the offered replies as
buttons, click to advance. Keeping it on the shop page means Dolan can comment on
what you just bought, and players find him where they already expect him.

(The old `/talk` Discord command from the previous draft is dropped — that bot is
archived.)

A dedicated **Town hub** page listing every talkable NPC makes sense *later*,
once there's more than one. Deferred.

### Endpoint sketch

- `GET  /api/talk/:npcId` — open a conversation: build `DialogueContext`,
  resolve `entry`, return the opening node (NPC line + eligible options).
- `POST /api/talk/:npcId` — `{ node, optionIndex }`: validate the pick is
  currently eligible, apply effects, persist the relation row, return the next
  node (or a closed signal for `end`).

State (opinion/familiarity/flags) is persisted server-side on the relation row;
the client only holds the current node + rendered options.

---

## Storage

| Data | Location | Notes |
|---|---|---|
| Dialogue trees | `database/dialogue/{npcId}/*.yaml` | runtime-loaded; LLM-drafted + reviewed |
| Character bible | `docs/lore/{npcId}.md` | author-time reference; **not** loaded at runtime |
| Player↔NPC relation | DB table `player_npc_relations` | one row per (character, npc) |
| Faction lean | player/character attribute, set at creation | new field |

---

## Authoring pipeline

1. Write the **character bible** (voice, biography, opinions, opinion-triggers).
2. Enumerate the **state buckets** worth distinct dialogue (e.g. "first meeting,"
   "town-leaning + low opinion," "veteran customer," "just lost a string of
   fights," "high blacksmith rank"). Not every combination — the ones that *say
   something about the character*.
3. For each bucket, have the LLM **draft** NPC lines + player replies in voice.
4. **Review/edit** into the tree YAML, wiring conditions + effects.
5. Playtest the tree-walk; tune opinion deltas and gating.

---

## Deferred (post-Dolan)

- **World-global NPC state** — the *broad* version: multiple scalars (stress,
  etc.) that evolve from **world events** and **propagate** between NPCs (Dolan's
  mood rippling to others). v1 ships only the single self-contained `mood` scalar
  (above), drifting on its own tick with no world-event inputs or propagation —
  that richer event-driven layer is deferred.
- **Runtime fragment composition** — the old combinatorial slot system, as a
  technique for ambient/idle barks. Superseded for conversations by authored
  trees; may return for ambient flavor.
- **Town hub page** — a directory of talkable NPCs. Needs >1 NPC first.
- **Service gating** — unlocking shop functions / quests by opinion or
  familiarity. Reads the same relation data; a separate access layer.
- **Full character customization** — revisiting faction and more, beyond the
  creation-time pick.
