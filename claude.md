# Idya - Discord RPG Battle Bot

## Overview

Idya is a Discord-based turn-based RPG battle bot (Alpha 1.0). Players engage in combat encounters against AI-controlled enemies through Discord slash commands and button interactions.

## Tech Stack

- **Runtime**: Node.js (v16.6.0+)
- **Language**: TypeScript (strict mode)
- **Discord**: discord.js v14
- **Build**: TypeScript compiler (`src/` → `lib/`)

## Project Structure

```
src/
├── character/           # Player and NPC classes
├── combat/              # Battle logic and turn resolution
├── discord/
│   ├── commands/        # Slash command definitions
│   └── handlers/        # Battle session and demo handling
├── weapon/
│   ├── action/          # Action types (strike, block, buff, etc.)
│   └── weapon.ts        # Weapon loader
├── infrastructure/      # Patterns and result fields
└── utility/             # Logger

database/
├── config.json          # Bot token (CLIENT_TOKEN)
├── weapons/             # Weapon YAML definitions
├── enemies/             # Enemy YAML definitions
├── shops/               # Shop YAML definitions
└── recipes/             # Crafting recipe YAML

docs/                    # All markdown — dev docs and SPA-served content
├── CHANGELOG.md         # Detailed dev changelog
├── CHANGELOG_DISCORD.md # Player-facing condensed changelog (auto-announced)
├── PRD.md               # Vision / product requirements
├── alpha_checklist.md   # TODOs before alpha
├── battle-ideas.md      # Design ideas / future work for combat
├── npc-dialogue-system.md
├── rules.md
├── demo.md
├── reference.md         # Served at /api/info/reference (Reference info page)
├── about.md             # Served at /api/info/about (About info page)
└── lore/
    ├── world.md         # Designer-facing world doc — NOT served
    ├── world_player.md  # Served at /api/info/lore (Lore info page)
    └── names.md         # Name pool
```

### Which markdown files are player-facing?

Only the three loaded by `/api/info/*` endpoints in `src/server/index.ts`:

| File | Endpoint | SPA route |
|---|---|---|
| `docs/reference.md` | `/api/info/reference` | `/app/reference` |
| `docs/about.md` | `/api/info/about` | `/app/about` |
| `docs/lore/world_player.md` | `/api/info/lore` | `/app/lore` |

Everything else under `docs/` is dev-only. When adding a new doc, decide first whether it's player-facing — if so, wire a `/api/info/*` endpoint to it and add a sidebar link in `public/app.html` + route in `public/app.js`.

## Key Concepts

### Combat System
- Turn-based with round progression
- Actions: Strike, Block, Buff, Debuff, Heal, DOT, Reflect, Shield
- Damage calculation applies modifiers in order: buffs → debuffs → blocks → shields
- Both player and NPC actions resolve per round

### Weapons
5 weapons, each with 6 action sets (Defend, Defend Crit, Attack, Attack Crit, Special, Special Crit). Defined in JSON under `database/weapons/`.

### Enemies
3 enemies (Rat, Zombie, Mushroom) with pattern-based AI. Patterns are sequences like `[1,2,2,3]` where 1=Defend, 2=Attack, 3=Special. Defined in `database/enemies/`.

### Discord Integration
- Slash commands: `/demobattle`, `/ping`
- Button interactions for combat choices
- Rich embeds for battle UI
- BattleManager tracks active sessions by channel ID

## Important Classes

- `Player_Character` / `NPC` (`src/character/`) - Character definitions
- `Battle` (`src/combat/battle.ts`) - Core battle logic
- `BattleManager` (`src/discord/handlers/battle_manager.ts`) - Session management
- `Weapon` (`src/weapon/weapon.ts`) - Weapon loading from JSON
- `Action` subclasses (`src/weapon/action/`) - Combat action types

## Scripts

```bash
npm start              # Run bot (from lib/)
npm run build          # Compile TypeScript
npm run refresh-commands  # Register slash commands with Discord
npm run cli-test       # Test battles in CLI
npm run lint           # Fix linting issues
```

## Configuration

Bot token goes in `database/config.json`:
```json
{
  "CLIENT_TOKEN": "your-token-here"
}
```

## Conventions

- Classes: `PascalCase` with underscores (`Player_Character`)
- Methods: `camelCase`
- JSON files: `snake_case`
- Action type IDs: 1=Strike, 2=Block, 3=Buff, 4=DOT, 5=Debuff, 6=Heal, 7=Reflect, 8=Shield, 9=Block Tile, 10=Buff Tile, 11=Hazard Tile, 12=Destroy Obstacle, 13=Slow Tile (planned — drops a 2×2 zone; leaving a slow tile costs +1 movement; placement: aimed sprays the 2×2 from the target tile, reactive uses the nearest enemy tile)
- Board-effect types (9+) are the 0.2.0 positional layer (**implemented**): 9/10 drop a permanent tile on the caster's square (allies standing on it gain block/buff each round — applied at action-phase start; buff feeds `CombatantState.tileBuff` into strike damage); 11 drops a tile that damages opposing units that *enter* it (checked in the move phase); 12 targets an obstacle in range, destroys it, and AOEs its field to enemies within 1. Tiles live on `Board` (`setTile`/`getTile`, serialized via `board.toJSON().tiles`); resolution hooks in `resolution.ts`; tile/obstacle targeting via `ActionInfo.targetsObstacle` in `public/game.js`. Tile actions: `src/weapon/action/tile_action.ts`, `destroy_obstacle.ts`.
- Action templates use placeholders: `<User>`, `<Target>`, `<Damage>`
- `Aimed: false` is the in-game term **reactive** — attack fires without targeting a specific tile
- `Aimed: true` is the in-game term **aimed** — player selects a target tile before the attack resolves

## Current System: Spatial Web Combat

The active combat system is the spatial grid-based web server in `src/server/index.ts` + `src/combat/`. The Discord handler system (`src/discord/`, `src/combat/battle.ts`) is **legacy** and not actively developed — it will be rebuilt to use the new spatial system.

Key files for the new system:
- `src/server/index.ts` — Express + Socket.io server, session management, test session setup
- `src/combat/combat_session.ts` — Session container, serializable state for the UI
- `src/combat/resolution.ts` — Turn resolution: move phase → action phase → cleanup
- `src/combat/action_resolver.ts` — Stateless action execution (strike, DOT, debuff, etc.)
- `src/combat/ai.ts` — AI intent generation from pattern
- `src/combat/enemy_loader.ts` — Loads enemy YAML into Combatant + CombatantMeta
- `public/` — Browser UI (game.html, game.js, game.css)

**Crit rule:** `attack_crit` fires when the actor uses Attack and the target is using Special that same turn. Fires before the main attack. Both aimed and reactive attacks check this.

## Design Notes

- **DOT overwrite is intentional** — applying a second DOT replaces the first. No stacking by design.
- **Player resistances** — currently players have no type resistances; only enemies do. Player class/race resistances are design space for later once the character system exists.
- **LOS tile feedback** — aimed tiles blocked by obstacles silently don't highlight. A tooltip or visual indicator for blocked LOS is a future UX improvement.
- **Weapon balance** — Aimed/Range decisions and damage field tuning are ongoing design work, not architecture.

## Economy System

### Professions
Three professions, each leveling 1–10. Combined cap: 30 (3 × 10).

| Profession | Crafts | Can upgrade |
|------------|--------|-------------|
| Lumberjack (LJ) | Wood + hybrid weapons | Any weapon with a wood component (quarterstaff, bow, wand, sword_wood, axe_wood, shovel_wood, sword_talamite, axe_talamite, shovel_talamite) |
| Blacksmith (BS) | Metal weapons | Talamite-only weapons (dagger, mace, wand_talamite) — NOT hybrid ones with wood handles |
| Enchanter | Enchanted upgrades | All weapons |

Hybrid weapons (sword_talamite, axe_talamite, shovel_talamite) are upgradeable by **both** LJ and BS — cross-profession collaboration is intentional.

### Upgrade Budget Schedule
Indexed by profession level (0–10). Levels with recipes give 0 budget increase; "empty" levels each raise the cap.

```
Level:   0  1  2  3  4  5   6   7   8   9  10
Budget:  0  0  0  0  3  7  12  12  18  25  35
```

Level 7 unlocks tier-3 material crafting but grants no budget increase (budget stays at 12).

### Upgrade Costs (per profession)
- **Upgrades 1–12** (budget unlocked at levels 4–6): cost **tier-2 material**
- **Upgrades 13–35** (budget unlocked at levels 8–10): cost **tier-3 material**

Cost formula: upgrade N costs **N** tier-2 units, or **(N − 10)** tier-3 units.

| Profession | Tier-2 material | Tier-3 material |
|------------|-----------------|-----------------|
| LJ | treated_sulwood | hardwood |
| BS | talamite | alloy |
| EN | hiruos | nodol |

### Recipe Progression
| Level | LJ | BS | EN |
|-------|----|----|-----|
| 1 | Quarterstaff → Axe (rework, TBD) | Pickaxe (L1 base; see 0.2.0 doc) | Deck of Cards (L1 base; see 0.2.0 doc) |
| 2 | Treated sulwood (smelt) + Quarterstaff (Treated, +atk) | Talamite (smelt) + Dagger (Talamite, +atk) | Hiruos (smelt) |
| 3 | All style weapons + components | Mace, heads, wand bases, assemblies | Kustaff, Wand (wood/talamite), Spellbook, Mental Cage |
| 4 | — (budget +3) | — (budget +3) | Physical enchant: sharp/blunt, +1 (costs 3 thuvel + 6 hiruos) |
| 5 | — (budget +4) | — (budget +4) | Arcane enchant: mental/force, +1 |
| 6 | — (budget +5) | — (budget +5) | Elemental enchant: fire/water/earth/wind/plant, +1 |
| 7 | Hardwood (smelt) + all hardwood variants (+all) | Alloy (smelt) + all alloy variants (+all) | Nodol (smelt) + all nodol weapon variants (+all) |
| 8 | — (budget +6) | — (budget +6) | Physical major enchant: type→Physical, any subtype, +3 (costs 3 thuvel + 6 hiruos + 9 nodol) |
| 9 | — (budget +7) | — (budget +7) | Arcane major enchant: type→Arcane, any subtype, +3 |
| 10 | — (budget +10) | — (budget +10) | Elemental major enchant: type→Elemental, any subtype, +3 |

**Enchant rules:** 3 slots per weapon max, one enchant per action, permanent. Minor enchants change subtype only. Major enchants change both Damage_Type and Damage_Subtype. Applied via `/api/enchant` endpoint (not the craft system).

## Weapon Balance Tooling

### Running the Simulation

```bash
npm run simulate
```

Builds and runs `src/tools/simulate.ts` — 5,000 Monte Carlo battles per weapon × enemy matchup. Outputs a table to stdout.

**Columns:** Win% | Avg rounds to win | Avg HP left (on win) | Damage per round dealt (DPR) | Damage per round taken (DTR)
`*` = >5% of battles hit the 80-round cap.

### Interpreting Results

- **Win%** is the primary balance metric. 60–80% vs the hardest enemy is a reasonable target for style-tier weapons.
- **Avg HP left** shows comfort margin. Winning at 2 HP isn't reliable in practice.
- **DPR** reflects offensive pressure. Low DPR + high Win% means the weapon is surviving on defense or crits.
- **Mushroom (100HP)** is the most discriminating matchup — use it to separate weapon tiers.
- **Range caveat:** The sim ignores spatial position. Ranged weapons (Bow, Wand, Deck of Cards) are systematically undervalued. Take their mushroom% with skepticism.

### Estimation Formula

Quick DPR estimate from YAML, without running the sim:

1. `base_DPR = avg(attack[0].Field)` where avg = sum / length
2. `cycle_factor = attacks_per_restore / (attacks_per_restore + 1)` where attacks_per_restore = floor(resource_max / attack_cost)
3. `effective_DPR ≈ base_DPR × cycle_factor`

Example — Axe Chop (Field [0,5,10,12], cost 2, Strength 5, Shoulder restores 4):
- base_DPR = 27/4 = 6.75
- attacks before restore = floor(5/2) = 2 → cycle_factor = 2/3
- effective_DPR ≈ 6.75 × 0.67 ≈ 4.5

Win rate is roughly: if `enemy_HP / effective_DPR` < `weapon_HP / DTR`, weapon tends to win.
Crits (attack_crit) add hidden DPR — estimate frequency from how often the enemy Pattern hits type 3 (Special).

## Removed Features (kept in YAML data, not used in combat)

### Stances (removed)
Were: Defensive / Balanced / Aggressive (D/B/A). Affected roll mode via `resolve_roll_mode()`:
- D vs A → both roll Ld2 (roll 2, take lowest)
- A vs B → attacker Hd4 (roll 4, take highest), defender Ld2
- B vs D → both 1d (baseline)

Removed because spatial movement + targeting gives equivalent skill expression without needing a separate stance layer. `src/infrastructure/stance.ts` still exists for reference but is no longer used by the new system.

### Damage Types & Resistances (active)
Every action has `Damage_Type` (Arcane / Physical / Elemental) and `Damage_Subtype` (Mental / Sharp / Blunt / Poison / etc.). Enemies have `Resistances` as multiplier scores (e.g. `Sharp: 1.25`, `Mental: 0.75`). Type and subtype scores multiply together, then map to a **roll mode** rather than a flat damage multiplier:

- combined score > 1.0 → **weakness** → Hd4 (roll 4 dice, take highest — big variance, skews high)
- combined score < 1.0 → **resist** → Ld2 (roll 2 dice, take lowest — skews low)
- combined score = 1.0 → **neutral** → 1d (single roll, baseline)

This means type matchups affect the *shape* of the damage roll, not a predictable percentage. A weakness doesn't guarantee more damage — it skews the odds dramatically. Log shows `[weakness — Hd4]` or `[resist — Ld2]` when active.
