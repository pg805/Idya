# Battle System — Design Document

*Last updated: February 2026*

---

## Overview

Idya's battle system is a turn-based RPG combat engine delivered through Discord buttons. Players choose a **stance** and an **action** each round against AI-controlled enemies. The system is designed to reward pattern recognition, resource management, and stance reads rather than pure luck.

---

## Core Combat Loop

Each round:

1. **Player selects stance** (Defensive / Balanced / Aggressive)
2. **Player selects action** (Defend / Attack / Special)
3. Both sides resolve simultaneously — player action and NPC action execute in priority order
4. Damage, effects, and end-of-round ticks apply
5. Winners are checked; if none, proceed to next round

**Action priority order:**

```
Defend → Attack → Special
```

Both sides' actions resolve in this order. If player Attacks and NPC Specials, player's Attack resolves before NPC's Special. This creates an interaction: attacking while the enemy Specials triggers a **crit**.

---

## Actions

### Action Types

| ID | Type    | Description |
|----|---------|-------------|
| 1  | Strike  | Deals damage from a `Field` array (sampled randomly) |
| 2  | Block   | Sets a flat damage absorption value for the round |
| 3  | Buff    | Adds a flat bonus to the user's outgoing Strike damage for N rounds |
| 4  | DOT     | Applies damage-over-time from a `Field` array for N rounds |
| 5  | Debuff  | Subtracts a flat value from the target's outgoing Strike damage for N rounds |
| 6  | Heal    | Restores a flat `Value` of health (capped at max HP) |
| 7  | Reflect | Returns a flat `Value` of incoming Strike damage back to the attacker for N rounds |
| 8  | Shield  | Absorbs a flat `Value` of incoming damage for N rounds (stacks with Block) |

### Damage Calculation (Strike)

```
damage = max(roll - block - shield + attacker_buff - attacker_debuff, 0)
```

Modifiers apply in this order: buff → debuff → block → shield. Damage floors at 0.

DOT damage is set when the DOT is applied (stance-influenced roll) and ticks at that fixed value for its duration — subsequent round stances do not affect existing DOT ticks.

### Field Arrays

Strike and DOT actions define their damage as a `Field` array. A random element is drawn each time damage is rolled. Repeated values increase the probability of that outcome.

Example — Shovel Whack: `[0, 3, 4, 5, 5, 5, 5, 6, 8, 10]`
- Mean: ~5.1
- 40% chance of rolling exactly 5

### Action Sets (per weapon)

Each weapon defines six action sets. The NPC action for the round determines which set is used:

| NPC Action | Player Action | What Fires |
|------------|---------------|------------|
| Any        | 1 (Defend)    | `Defend` |
| Any        | 1 (Defend)    | `Defend Crit` (future — not yet used) |
| 3 (Special)| 2 (Attack)    | `Attack Crit` + `Attack` |
| Any        | 2 (Attack)    | `Attack` |
| 3 (Special)| 2 (Attack)    | NPC `Attack Crit` + NPC `Attack` |
| Any        | 2 (Attack)    | NPC `Attack` |
| Any        | 3 (Special)   | `Special` |
| Any        | 3 (Special)   | `Special Crit` (future — not yet used) |

Crits trigger when your action and the enemy's action create a priority intersection: you attack while they special (or vice versa). This gives a second action set's effects in addition to the normal one.

---

## Weapons

Weapons are defined in YAML files under `database/weapons/`. Each weapon has:

- **Name / Description**
- **Resource**: a named resource with a max value (e.g. Stamina: 6, Luck: 20)
- **Six action sets**: Defend, Defend Crit, Attack, Attack Crit, Special, Special Crit
- Each action in a set has: Name, Type, Value or Field, Cost (negative = restore), Rounds (for timed effects), Action_String

### Current Weapons

| Weapon | Resource | Defend | Attack | Special |
|--------|----------|--------|--------|---------|
| Shovel | Stamina (6) | Block 7 | Strike [0,3,4,5,5,5,5,6,8,10] | Strike [5,10,10,20] |
| Awakened Mind | Tranquility (12) | Buff +7 / Block 5 | Strike [1,1,1,2,3,4] | Debuff -8 |
| Can of Paint | Paint (10) | Heal 7 / Block 2 | Strike [0,7,7,7] | DOT [2,3,5,7] ×3 |
| Deck of Cards | Luck (20) | Block 4 | Strike [2–11] / Strike 11 | Strike [1,12,17,22] / Strike 22 |
| Vines and Thorns | Connection (5) | Reflect 5 / Shield 5 | Strike [0,2,2,3,4,5] | DOT [1,3] ×3 |

---

## Resources

Each weapon has a named resource (Stamina, Tranquility, Paint, Luck, Connection). Actions have a `Cost` field:
- Negative cost = resource is **restored** (recovering a resource on a defensive move rewards playing defensively)
- Positive cost = resource is **consumed**

Resource management is tracked but not yet enforced as a hard limit in Alpha 1.0. Full enforcement is planned pre-beta.

---

## Stance System

Stance is chosen each round alongside the action. It modifies the **roll mode** used when sampling from a damage `Field` array.

### Roll Modes

| Mode | Mechanic | Effect on expected value |
|------|----------|--------------------------|
| Ld2  | Roll 2 dice, take lowest | ~25–35% below mean |
| 1d   | Roll 1 die | Baseline mean |
| Hd2  | Roll 2 dice, take highest | ~25–35% above mean |
| Hd4  | Roll 4 dice, take highest | ~35–65% above mean |

Fixed-value actions (Block, Heal, Buff, Debuff, Reflect, Shield) are not affected by stance on their own value. Only `Field`-based actions (Strike, DOT) are rolled with the stance-determined mode.

### Stance Base Effects

| Stance | Your attack rolls | Incoming attack rolls |
|--------|------------------|-----------------------|
| Defensive | Ld2 | Ld2 (attacker biased down) |
| Balanced | 1d | 1d |
| Aggressive | Hd4 | Hd2 (attacker biased up — you're exposed) |

### Counter Interactions (Rock-Paper-Scissors)

Counters override the base effects:

| Matchup | Winner | Result |
|---------|--------|--------|
| D vs A (either direction) | Defensive | Both sides roll **Ld2** — A's aggression is absorbed |
| N vs D (either direction) | Balanced | Both sides roll **1d** — D's defensive shell is broken |
| A vs N: A attacks N | Aggressive | A rolls **Hd4** — full offense |
| A vs N: N attacks A | Aggressive | N rolls **Ld2** — N is penalized |

### Full 3×3 Roll Mode Table

Roll mode when **Row attacks Column**:

| Attacker \ Defender | Defensive | Balanced | Aggressive |
|---------------------|-----------|----------|------------|
| **Defensive**       | Ld2       | 1d       | Ld2        |
| **Balanced**        | 1d        | 1d       | Ld2        |
| **Aggressive**      | Ld2       | Hd4      | Hd4        |

### Strategic Implications

| My stance | vs D | vs N | vs A |
|-----------|------|------|------|
| Defensive | Ld2/Ld2 — slow attrition | 1d/1d — D's shell broken, normal fight | Ld2/Ld2 — A neutralized, D survives |
| Balanced | 1d/1d — even | 1d/1d — even | Ld2/Hd4 — N takes a beating |
| Aggressive | Ld2/Ld2 — neutralized | Hd4/Ld2 — A crushes | Hd4/Hd4 — chaotic mirror |

### Key Quantitative Impact (selected examples)

| Scenario | Ld2 | 1d | Hd4 |
|----------|-----|----|-----|
| Shovel Whack avg | 3.8 | 5.1 | 7.6 |
| Shovel Charge avg | 8.4 | 11.3 | 16.8 |
| Deck Suit avg | 8.8 | 13.0 | 20.1 |
| Spore Bath (×5 total) | 6.9 | 10.0 | 16.3 |
| Rat Scratch incoming | 3.3 | 5.0 | 6.7 |
| Rat Bite incoming | 7.9 | 10.5 | 13.1 |

DOTs are the most stance-sensitive mechanic due to compounding over rounds.

### Future: Multi-Round Stance Commitment

Planned but not yet implemented. A player could commit to a stance for 2–3 rounds in exchange for a bonus (e.g. Hd5 for 2-round Aggressive commitment). During commitment, stance cannot change. Commitment level chosen at the start of the locked period.

---

## Enemies

Enemies are defined in YAML under `database/enemies/`. Each enemy has:

- **Health**: total HP pool
- **Pattern**: an array cycling through 1 (Defend), 2 (Attack), 3 (Special)
- **Image**: Discord embed image URL
- **Weapon**: inline weapon definition with the same action set structure as player weapons

### Current Enemies

| Enemy | HP | Pattern | Notes |
|-------|----|---------|-------|
| Rat | 30 | [1,2,3] | Beginner. Balanced pattern. |
| Zombie | 50 | [2,1,3] | Attacks first. DOT on crit. |
| Mushroom | 100 | [3,2,1,1,1,1] | Boss-tier. DOT primary, attack-heavy. |

### NPC Stances

Currently all NPCs default to **Balanced** stance every round. The stance system architecture supports per-round NPC stance patterns (using the same Field/Pattern infrastructure). This is the next planned step for enemy design.

Future format — stance pattern alongside action pattern in YAML:
```yaml
Pattern: [1, 2, 3]
Stance_Pattern: [D, B, A]  # cycles independently or in sync with action pattern
```

---

## Discord UI

Battle flow:

1. `/demobattle` → weapon selection embed
2. Demo button → battle starts, embed shows two rows:
   - **Row 1**: Stance buttons (Defensive / Balanced / Aggressive) — all enabled
   - **Row 2**: Action buttons (Defend / Attack / Special) — **disabled** until stance chosen
3. Player clicks stance → stance highlighted, action buttons enabled
4. Player clicks action → round resolves, embed updates with round log, buttons reset (action disabled, stance unselected)
5. Repeat until winner

The embed always shows: player HP, enemy HP, round log (bolded keywords), and a telegraph hint for the next enemy action.

### NPC Telegraphing

After each round, the embed shows a hint about the enemy's next action and stance. Current implementation reveals the **exact next action** (Defend/Attack/Special) and current NPC stance (always Balanced).

Future intent: Telegraphing should feel like reading your opponent rather than a guaranteed spoiler. Options under consideration:
- **Partial telegraphing**: reveal action category but not the specific move
- **Stance telegraphing**: always reveal NPC stance (since it can be inferred from pattern), keep action hints flavor-based
- **Confidence levels**: some enemies telegraph clearly, others are deceptive (telegraphed action doesn't match actual)

---

## Weapon & Enemy Levels

Each weapon and enemy has a `Level` field. Higher = more powerful. Demo weapons span 2–5; player-crafted weapons can exceed this with no upper bound.

### Weapon Level Formula

```
Score = Attack_floor_mean × 1.0    // cheapest/free attack action
      + Best_burst_mean   × 0.4    // best non-floor attack or damaging special
      + Best_defend_value × 0.4    // single-round value of best defend action
      + Utility_total     × 0.2    // (buff×rounds) + (debuff×rounds) + heal values summed

Level = floor(Score / 4)
```

Auto-classification from action type IDs (no manual tagging needed):
- **Types 1, 4** (Strike, DOT) → attack/burst
- **Types 2, 8** (Block, Shield) → defense
- **Types 3, 5** (Buff, Debuff) → utility — always, by design
- **Type 6** (Heal) → utility
- **Type 7** (Reflect) → defense

### Enemy Level Formula

```
eHP   = HP × (1 + avg_mitigation_per_round / 5)
Score = avg_enemy_DPS × 0.5 + eHP × 0.1

Level = floor(Score / 4)
```

Where `avg_mitigation_per_round` = total block/shield/heal value per pattern cycle ÷ cycle length.

### Current Levels

| Entity | Score | Level |
|--------|-------|-------|
| Awakened Mind | 21.2 | 5 |
| Deck of Cards | 20.1 | 5 |
| Can of Paint | 16.0 | 4 |
| Shovel | 13.9 | 3 |
| Vines and Thorns | 8.1 | 2 |
| Mushroom (enemy) | 23.7 | 5 |
| Zombie (enemy) | 8.2 | 2 |
| Rat (enemy) | 6.6 | 1 |

---

## Damage Types

Each action defines two YAML fields: `Damage_Type` (main type) and `Damage_Subtype`. Drives future resistance/weakness logic. Currently stored in YAML but not enforced in combat.

### Main Types

| Type | Description |
|------|-------------|
| Physical | Brute force, direct impact. |
| Arcane | Psychic and magical. Mind-based or enchanted. |
| Elemental | Natural forces. Environmental, organic, or alchemical. |

### Subtypes

All subtypes can combine with any main type as flavor and balance permit.

| Subtype | Description |
|---------|-------------|
| Blunt | Impact, force, concussive |
| Sharp | Cutting, piercing, slicing |
| Mental | Mind-affecting |
| Earth | Stone, gravity, telekinetic mass |
| Aqua | Liquid, paint, alchemical fluid |
| Plant | Growth, nature, organic |
| Poison | Disease, toxin, corruption |
| Fire | Heat, combustion, burning |
| Air | Wind, breath, pressure |

### Current Assignments

| Weapon / Enemy | Action | Type | Subtype |
|----------------|--------|------|---------|
| Shovel | Block | Physical | Blunt |
| Shovel | Whack | Physical | Blunt |
| Shovel | Proc | Physical | Sharp |
| Shovel | Charge | Physical | Blunt |
| Awakened Mind | Stone Telekinesis | Arcane | Earth |
| Awakened Mind | Forewarn | Arcane | Mental |
| Awakened Mind | Hurl Rock | Arcane | Earth |
| Awakened Mind | Mental Pressure | Arcane | Mental |
| Awakened Mind | Eye Fixation | Physical | Mental |
| Can of Paint | Mix Paint | Elemental | Aqua |
| Can of Paint | Paint Can | Physical | Blunt |
| Can of Paint | Paint Coat | Elemental | Aqua |
| Can of Paint | Blind | Elemental | Aqua |
| Can of Paint | Paint Dry | Elemental | Aqua |
| Deck of Cards | Shuffle | Arcane | Blunt |
| Deck of Cards | Rank | Physical | Sharp |
| Deck of Cards | Ace | Arcane | Sharp |
| Deck of Cards | Joker | Arcane | Mental |
| Deck of Cards | Suit | Physical | Sharp |
| Deck of Cards | Spades | Arcane | Sharp |
| Vines and Thorns | Thorns | Elemental | Sharp |
| Vines and Thorns | Vines | Elemental | Blunt |
| Vines and Thorns | Branch | Physical | Blunt |
| Vines and Thorns | Grow | Elemental | Plant |
| Vines and Thorns | Constrict | Elemental | Blunt |
| Rat | Curl Up | Physical | Blunt |
| Rat | Scratch | Physical | Sharp |
| Rat | Bite | Physical | Sharp |
| Zombie | Dead Skin | Arcane | Blunt |
| Zombie | Scratch | Physical | Sharp |
| Zombie | Infect | Elemental | Poison |
| Zombie | Bite | Physical | Sharp |
| Mushroom | Retreat | Elemental | Blunt |
| Mushroom | Regenerate | Elemental | Plant |
| Mushroom | Spore Bath | Elemental | Poison |
| Mushroom | Allergic Reaction | Arcane | Poison |
| Mushroom | Faery Ring | Elemental | Blunt |

### Resistance System (Planned)

Resistances apply to incoming Strike and DOT damage only (not Block/Heal/Buff/Debuff).

**Multipliers:** `0.75×` resist, `1.0×` neutral, `1.25×` weakness. Damage is rounded down after applying modifiers.

**Stacking:** Main type and subtype modifiers multiply together.
- Example: Physical Sharp vs. Zombie — Physical `1.0×` × Sharp `1.25×` = `1.25×` (weak)
- Example: Arcane Mental vs. Zombie — Arcane `1.0×` × Mental `0.75×` = `0.75×` (resist)
- Example: Elemental Poison vs. Mushroom — Elemental `1.0×` × Poison `0.75×` = `0.75×` (resist)

**YAML format** (flat key lookup — main types and subtypes share no names):

```yaml
Resistances:
  Mental: 0.75    # subtype resist
  Sharp: 1.25     # subtype weakness
```

**Current enemy resistances:**

| Enemy | Key | Modifier | Reasoning |
|-------|-----|----------|-----------|
| Rat | — | all 1.0× | Completely neutral |
| Zombie | Mental | 0.75× | No mind to affect |
| Zombie | Sharp | 1.25× | Decayed flesh is easy to cut |
| Mushroom | Physical | 0.75× | Tough fibrous body resists brute force |
| Mushroom | Poison | 0.75× | It generates poison — resistant to it |
| Mushroom | Fire | 1.25× | Fungal caps are highly flammable |
| Mushroom | Air | 1.25× | Spores scatter; air disrupts its structure |

Note: Fire and Air subtypes are not used by any current weapon — they are forward-looking design space opened by these weaknesses.

---

## Future: Rewards

Not yet implemented. Battles should produce meaningful output that feeds the broader economy.

### Proposed Reward Sources

| Source | Drops |
|--------|-------|
| Any enemy kill | Currency (flat or range) |
| Enemy kill | Crafting components (weighted loot table per enemy) |
| Crit during round | Small bonus drop chance |
| Stance counter landed | Potential bonus modifier |
| Battle completion (win) | XP toward specialty levels |

### Loot Table Format (proposed YAML)

```yaml
Loot:
  Currency: [10, 25]   # range, rolled on kill
  Drops:
    - Item: rat_claw
      Chance: 0.6
    - Item: rodent_fur
      Chance: 0.3
    - Item: small_fang
      Chance: 0.1
```

### Open Questions

- Does losing a battle give partial rewards?
- Are crafting components used directly or refined first?
- Is there an XP system separate from currency, or does currency serve both roles?

---

## Future: Multiple Enemies

Planned for post-MVP. Core design considerations:

- **Turn order**: Does player go before all enemies, or interleaved? Likely a single player turn then all enemies resolve.
- **Targeting**: Player must choose a target for offensive actions. Defensive actions protect self.
- **Stance applies globally**: One stance per round affects all incoming/outgoing damage, not per-enemy.
- **Enemy patterns still cycle independently** per enemy.
- **Kill order matters**: Defeating the highest-threat enemy first changes the damage intake significantly.

UI challenge: Discord's button limit (25 per message) becomes a constraint when adding targeting on top of stance + action.

---

## Future: Multiple Allies

Planned post-MVP for co-op PvE. Considerations:

- Each ally acts independently (their own stance + action per round).
- Shared HP pool vs individual HP pools — TBD.
- Friendly fire from reflect/AOE is a question.
- Could introduce a **support role**: one ally focuses on buffs/heals while another attacks.
- The battle session (currently 1:1 per channel message) would need to support multi-player input before resolving.

---

## Future: PvP

Planned post-MVP. Key differences from PvE:

- **Stances are hidden**: Both players choose simultaneously (blind pick). No telegraphing.
- **No patterns**: The opponent is unpredictable. Counter reads become pure mind-game.
- **Both players choose actions**: No predetermined NPC sequence.
- **Session management**: Requires coordinating two Discord users, probably on a shared battle message or two-message approach.
- **Balance**: The stance counter table was designed with PvP in mind. A>N decisiveness vs N>D normalization vs D>A neutralization creates meaningful choices without a dominant strategy.
- **Ranking system**: TBD (ELO, ladder, seasonal, etc.)

---

## Open Questions

| Area | Question |
|------|----------|
| Resistances — immune | Decided: `0.0×` is valid (immune). No current uses, reserved for future design. |
| Stance multi-round | Exact bonus for 2-round vs 3-round commitment |
| NPC stances | Pattern-synced vs independent cycling |
| Telegraphing depth | How much to reveal for each enemy tier? |
| Rewards | XP separate from currency, or unified? |
| Resource enforcement | Hard cap now, or soft signals first? |
| Defend Crit | What should trigger it? (currently unused) |
| Special Crit | Same question for player Special Crit |
