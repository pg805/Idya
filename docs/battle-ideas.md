# Idya - Design Ideas & Future Work

Decisions locked into the current build are in CLAUDE.md. This file is for things we want to do but aren't building yet.

---

## Combat System — Spatial (in progress on dev-spatial)

### Locked decisions
- 7x5 default grid, dimensions are config not hardcoded
- Simultaneous intent: player submits move + action together, all resolve at once
- Actions flagged **aimed** (hits the tile you targeted at submission time) vs **reactive** (recalculates target position at resolution)
- Movement: 2 tiles/turn for now, will become a weapon/item stat
- Diagonal movement: alternating 1-2-1-2 cost (DnD 3.5 style), averages 1.5 — diagonals aren't free but aren't punishing
- Obstacles: path around them for now, no interaction
- Line of sight: Bresenham's line to start; add corner-peek rules later
- Board persists and is mutable — obstacle state (intact/damaged/destroyed) tracked per tile
- Grid rendering: CSS grid to start, migrate to canvas when animation matters

### Future ideas
- **Movement priority** — currently: players > AI, same-priority ties block both. Cases to design:
  - Action-type priority: Defend intent faster than Attack, Attack faster than Special (mirrors original action system)
  - Speed stat per character or weapon
  - Charging (moving toward enemy) vs holding ground priority rules
  - PvP: should ties always block, or resolve by some tiebreaker (first to submit, random, speed stat)?
  - Multi-tile chains: if A bumps B who bumps C, resolve as a chain or all block?
- Movement range as a weapon/character stat (currently hardcoded to 2)
- Obstacle interaction: attack to damage/destroy, push, use as cover modifier
- Corner-peeking LoS rules (define whether adjacent diagonal obstacles block)
- Fog of war for team vs team
- Procedural board generation: tight corridors for sewers/dungeons, scattered cover for forests — seeded by enemy type or location
- Destructible environment tiles that change board state mid-fight
- Elevation tiles (high ground = range bonus, low ground = penalty)
- Knockback actions that change combatant position on hit

---

## Multiplayer

- PvP 1v1: same session model, Team B combatants are human-controlled
- Team vs team: N combatants per side, resolve all intents simultaneously
- Spectator mode: read-only socket connection to a session

---

## Discord Integration

- Discord stays as hub: matchmaking, results, inventory, shop, character progression
- `/battle` creates a session and posts a link; combat happens in browser
- Post-battle results summary back to the Discord channel

---

## Weapons & Actions

- Per-weapon movement stat (replaces global default of 2)
- Per-action range tiers: melee (0-1), mid (2-3), ranged (4+)
- Aimed vs reactive as part of action JSON definition in database/weapons/
- Area-of-effect actions (hit a tile + adjacent tiles)

---

## Board & UI

- Larger board sizes for team fights
- Canvas renderer for animation: movement trails, impact effects, status indicators
- Minimap or replay viewer for post-battle review
- Mobile-friendly layout
- **Environment color schemes** — swap CSS variables per board theme:
  - Sewer/Underground: muted greens, damp stone browns, dark water blue
  - Forest: deep greens, earth tones, filtered light amber
  - Dungeon: cold stone gray, torch orange accents, ominous deep red
  - Desert ruins: bleached beige, harsh yellow, crumbling sandstone
  - Volcanic: char black, lava orange, ash gray
  - Tundra: ice blue, stark white, frozen steel gray
  - Ancient ruins: faded purple, crumbling stone, tarnished gold

---

## Meta / Long-term

- Location system: different maps/biomes with unique board templates
- Player progression: stats, gear, unlockable weapons
- Ranked PvP matchmaking via Discord
- Spectator betting (currency wagered on match outcomes)

---

## Legacy Battle System Reference

*From the original Discord button-based design — partially superseded by the spatial system. Stances and the action priority system may be scrapped or reimagined; preserving here while undecided.*

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

Modifiers apply in order: buff → debuff → block → shield. Damage floors at 0.

DOT damage is set when the DOT is applied (stance-influenced roll) and ticks at that fixed value for its duration — subsequent round stances do not affect existing DOT ticks.

### Field Arrays

Strike and DOT actions define their damage as a `Field` array. A random element is drawn each time damage is rolled. Repeated values increase the probability of that outcome.

Example — Shovel Whack: `[0, 3, 4, 5, 5, 5, 5, 6, 8, 10]`

### Action Priority Order (original system)

```
Defend → Attack → Special
```

Both sides' actions resolve in this order. If player Attacks and NPC Specials, player's Attack resolves before NPC's Special — attacking while the enemy Specials triggers a **crit** (fires an extra action set).

### Weapon Structure

Each weapon has six action sets: Defend, Defend Crit, Attack, Attack Crit, Special, Special Crit. Defined in YAML under `database/weapons/`. Each weapon also has a named **resource** (e.g. Stamina, Luck) with a max value. Actions have a `Cost` field — negative restores, positive consumes. Resource enforcement was planned but not implemented.

### Current Weapons

| Weapon | Resource | Defend | Attack | Special |
|--------|----------|--------|--------|---------|
| Shovel | Stamina (6) | Block 7 | Strike [0,3,4,5,5,5,5,6,8,10] | Strike [5,10,10,20] |
| Awakened Mind | Tranquility (12) | Buff +7 / Block 5 | Strike [1,1,1,2,3,4] | Debuff -8 |
| Can of Paint | Paint (10) | Heal 7 / Block 2 | Strike [0,7,7,7] | DOT [2,3,5,7] ×3 |
| Deck of Cards | Luck (20) | Block 4 | Strike [2–11] / Strike 11 | Strike [1,12,17,22] / Strike 22 |
| Vines and Thorns | Connection (5) | Reflect 5 / Shield 5 | Strike [0,2,2,3,4,5] | DOT [1,3] ×3 |

### Weapon Level Formula

```
Score = Attack_floor_mean × 1.0
      + Best_burst_mean   × 0.4
      + Best_defend_value × 0.4
      + Utility_total     × 0.2

Level = floor(Score / 4)
```

### Enemy Level Formula

```
eHP   = HP × (1 + avg_mitigation_per_round / 5)
Score = avg_enemy_DPS × 0.5 + eHP × 0.1
Level = floor(Score / 4)
```

### Current Enemies

| Enemy | HP | Pattern | Level |
|-------|----|---------|-------|
| Rat | 30 | [1,2,3] | 1 |
| Zombie | 50 | [2,1,3] | 2 |
| Mushroom | 100 | [3,2,1,1,1,1] | 5 |

Pattern numbers: 1=Defend, 2=Attack, 3=Special.

### Stance System (may scrap)

Stance chosen each round, modifies the roll mode for Field-based damage.

| Mode | Mechanic |
|------|----------|
| Ld2  | Roll 2, take lowest (~25–35% below mean) |
| 1d   | Single roll (baseline) |
| Hd2  | Roll 2, take highest (~25–35% above mean) |
| Hd4  | Roll 4, take highest (~35–65% above mean) |

**Stance base effects:**

| Stance | Your attacks | Incoming attacks |
|--------|-------------|-----------------|
| Defensive | Ld2 | Ld2 |
| Balanced | 1d | 1d |
| Aggressive | Hd4 | Hd2 (you're exposed) |

**Counter interactions (rock-paper-scissors):**

| Matchup | Result |
|---------|--------|
| D vs A | Both roll Ld2 — aggression absorbed |
| N vs D | Both roll 1d — defensive shell broken |
| A vs N (A attacks) | A rolls Hd4 |
| A vs N (N attacks A) | N rolls Ld2 |

**Full 3×3 table (row attacks column):**

| Attacker\Defender | D | N | A |
|-------------------|---|---|---|
| Defensive | Ld2 | 1d | Ld2 |
| Balanced | 1d | 1d | Ld2 |
| Aggressive | Ld2 | Hd4 | Hd4 |

**Multi-round commitment** (planned, not built): commit to a stance for 2–3 rounds for a bonus (e.g. Hd5 for 2-round Aggressive commitment). Stance locked during commitment.

### Damage Types & Resistances

**Main types:** Physical, Arcane, Elemental

**Subtypes:** Blunt, Sharp, Mental, Earth, Aqua, Plant, Poison, Fire, Air

Resistances multiply: `0.75×` resist, `1.0×` neutral, `1.25×` weakness. Main type × subtype stack multiplicatively.

| Enemy | Modifier | Key |
|-------|----------|-----|
| Rat | all 1.0× | neutral |
| Zombie | Mental 0.75×, Sharp 1.25× | no mind; decayed flesh |
| Mushroom | Physical 0.75×, Poison 0.75×, Fire 1.25×, Air 1.25× | fibrous body; generates poison; flammable caps |

Note: Fire and Air subtypes have no current weapon coverage — they are open design space.

### NPC Telegraphing (Discord era)

After each round, a hint about the enemy's next action appeared in the embed. Options under consideration for the future:
- Partial telegraphing (category not specific move)
- Confidence levels (some enemies telegraph deceptively)
- Stance always revealed (inferrable from pattern), action kept as flavor hint

### Open Questions (carried forward)

| Area | Question |
|------|----------|
| Stances | Keep, scrap, or reimagine for spatial system? |
| Defend Crit | What triggers it? (was unused) |
| Special Crit | Same |
| Resource enforcement | Hard cap or soft signals? |
| Rewards | XP separate from currency, or unified? |
| Partial rewards | Does losing give anything? |
| NPC stances | Pattern-synced vs independent cycling |
