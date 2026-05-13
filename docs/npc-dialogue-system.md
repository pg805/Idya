# NPC Dialogue System — Design Spec

## Core Idea

Emergent dialogue from simple rules. Instead of writing complete scripted lines, dialogue is *assembled* at runtime from fragment slots conditioned on state. Complex, varied output falls out of combinations — no LLM, no infinite branching tree.

---

## Fragment Composition

### How it works

A dialogue entry is a template with named slots. Each slot has a pool of options, each with optional conditions. At runtime, eligible options are filtered by current state, one is selected (randomly or weighted), and the template is assembled.

```yaml
# database/dialogue/fendalok/greeting.yaml
template: "{opener} {concern} {aside}"

slots:
  opener:
    - text: "Good morning."
      conditions:
        timeOfDay: morning
    - text: "Ah, {playerName}."
      conditions:
        familiarity: ">=2"
    - text: "What brings you here?"
      conditions: {}              # always eligible

  concern:
    - text: "Taxes are due again."
      conditions:
        recentEvents: includes tax_collector_visited
    - text: "That mushroom sighting has me worried."
      conditions:
        recentEvents: includes mushroom_spotted
    - text: "Town's been quiet."
      conditions: {}

  aside:
    - text: ""                    # no aside — always eligible
      conditions: {}
    - text: "But that's not your problem."
      conditions:
        trust: "<5"
    - text: "Morna's been asking about you."
      conditions:
        familiarity: ">=3"
```

4 openers × 5 concerns × 3 asides = 60 possible combinations from ~12 written fragments.

### Template variables

Slots can reference state values directly: `{playerName}`, `{townName}`, `{daysSinceLastVisit}`. These are substituted after assembly.

### Selection weighting

Options can carry an optional `weight` field (default 1). Higher weight = more likely when eligible. Useful for making neutral fallbacks less dominant once better options unlock.

---

## NPC State

Each NPC has global state — independent of any player — that evolves based on world events.

```typescript
interface NPCState {
  npcId: string;

  // Scalar scores, 0–10, drift toward baseline over time
  stressLevel: number;
  moodScore: number;
  trustOfStrangers: number;

  // Recent world events affecting this NPC, with expiry timestamps
  recentEvents: Array<{ event: string; expiresAt: Date }>;
}
```

### Event triggers

World events mutate NPC state directly. Propagation between NPCs is also handled here — no general pub/sub, just explicit function calls.

```typescript
onWorldEvent("tax_collector_visited", () => {
  fendalok.stressLevel    = clamp(fendalok.stressLevel + 3, 0, 10);
  fendalok.trustOfStrangers = clamp(fendalok.trustOfStrangers - 2, 0, 10);
  fendalok.recentEvents.push({ event: "tax_collector_visited", expiresAt: daysFromNow(3) });

  // Propagate: Fendalok's stress affects Morna
  morna.moodScore = clamp(morna.moodScore - 1, 0, 10);
});
```

### State decay

A daily tick drifts scalar scores back toward their baseline and removes expired events.

```typescript
function tickNPCState(npc: NPCState, baseline: NPCStateBaseline) {
  npc.stressLevel  = lerp(npc.stressLevel,  baseline.stressLevel,  DECAY_RATE);
  npc.moodScore    = lerp(npc.moodScore,    baseline.moodScore,    DECAY_RATE);
  npc.recentEvents = npc.recentEvents.filter(e => e.expiresAt > now());
}
```

---

## Player–NPC Relation

Separate from NPC global state. Tracks the relationship between a specific player and a specific NPC.

```typescript
interface PlayerNPCRelation {
  playerId: string;
  npcId: string;

  metBefore: boolean;
  familiarity: number;        // increases with each interaction
  trust: number;              // changes based on player actions, 0–10

  sharedHistory: string[];    // event flags specific to this player
                              // e.g. ["completed_fendalok_task_1", "was_rude_in_greeting"]
}
```

### Familiarity vs. trust

These are separate axes intentionally. Fendalok can know you well (high familiarity) but have reason to be wary (low trust), or trust you quickly without knowing you yet. Both affect which dialogue options are eligible.

---

## Dialogue Selection Pipeline

At runtime when a player initiates `/talk [npc]`:

1. Load NPC global state
2. Load player–NPC relation (create default if first meeting)
3. Merge into a **context object** passed to the slot evaluator
4. For each slot in the template, filter options whose conditions all pass
5. Weighted random selection from eligible options
6. Assemble template string
7. Substitute variables (`{playerName}` etc.)
8. Post to Discord; update `metBefore`, increment `familiarity`

### Context object shape

```typescript
interface DialogueContext {
  // NPC global state
  stressLevel: number;
  moodScore: number;
  trustOfStrangers: number;
  recentEvents: string[];     // just the event strings, expiry already filtered

  // Player–NPC relation
  metBefore: boolean;
  familiarity: number;
  trust: number;
  sharedHistory: string[];

  // World/time
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  playerName: string;
  daysSinceLastVisit: number;
}
```

---

## Condition Syntax

Conditions on slot options are key-value pairs evaluated against the context object. Keep it simple — no scripting language.

| Condition form | Example | Meaning |
|---|---|---|
| `key: value` | `metBefore: true` | Exact match |
| `key: ">=N"` | `familiarity: ">=3"` | Numeric comparison |
| `key: "<=N"` | `trust: "<=4"` | Numeric comparison |
| `key: includes value` | `recentEvents: includes tax_collector_visited` | Array contains |
| `key: excludes value` | `sharedHistory: excludes completed_task_1` | Array does not contain |

An option with no conditions is always eligible (fallback).

---

## Storage

| Data | Location | Notes |
|---|---|---|
| Dialogue definitions | `database/dialogue/{npcId}/*.yaml` | Authored content, not in DB |
| NPC global state | DB table `npc_states` | One row per NPC, updated by event system |
| Player–NPC relations | DB table `player_npc_relations` | One row per (player, npc) pair |
| World events log | DB table `world_events` | Append-only, used to reconstruct/audit state |

---

## What This Does Not Cover

- **Service gating**: Which professions or commands an NPC unlocks based on trust/familiarity — that's a separate access-control layer that reads the same `PlayerNPCRelation` data.
- **Dialogue trees**: Multi-turn conversations with player choices. This spec covers NPC *greeting/ambient* lines. A choice tree (Telltale-style) uses the same state but needs a separate branching structure.
- **Tutorial/intro scripts**: First-meeting dialogue for key NPCs can be fully scripted (ignoring the slot system) and transition into the slot system afterward.
