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
├── character/           # Character persistence (repository, sprites, player_character)
├── combat/              # Spatial combat: resolution, AI, sessions, board
├── server/              # Express + Socket.io web server (the live system)
├── economy/             # Crafting, upgrades, rewards
├── weapon/
│   ├── action/          # Action types (strike, block, buff, etc.)
│   └── weapon.ts        # Weapon loader
├── infrastructure/      # Patterns and result fields
└── utility/             # Logger

archive/                 # Frozen legacy, excluded from build (tsconfig)
├── discord/             # Old Discord bot (commands + handlers)
├── battle.ts            # Old turn-based combat engine
└── test_battle.ts       # Its CLI driver

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

- `Combatant` / `CombatantMeta` (`src/combat/combat_session.ts`) - Live unit + its weapon/state/AI pattern
- `resolveIntents` (`src/combat/resolution.ts`) - Core turn resolution (move → action → cleanup)
- `CombatSession` (`src/combat/combat_session.ts`) - Session container + serializable state
- `Weapon` (`src/weapon/weapon.ts`) - Weapon loading from JSON
- `Action` subclasses (`src/weapon/action/`) - Combat action types

## Scripts

```bash
npm start              # Run the web server (from lib/)
npm run build          # Compile TypeScript
npm run simulate       # Monte-Carlo weapon-balance sim
npm run lint           # Fix linting issues
node lib/tools/test_tiles.js     # Spatial combat smoke tests
node lib/tools/cost_report.js N  # Budget report for level N
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
- Action type IDs: 1=Strike, 2=Block, 3=Buff, 4=DOT, 5=Debuff, 6=Heal, 7=Reflect, 8=Shield, 9=Block Tile, 10=Buff Tile, 11=Hazard Tile, 12=Destroy Obstacle, 13=Slow Tile (leaving it costs +1 movement), 14=Move Debuff (unit-attached: caps the target's movement to `Value` for `Rounds` turns — distinct from the positional slow tile; see `effectiveMove` in `combatant_state.ts`)
- **`Area: N`** is a general field on any action: tile actions (9/10/11/13) drop an N×N block; attacks/DOTs (1/4) become an N×N AOE. Geometry (`areaBlock` in `resolution.ts`): odd N centers on the target; even N puts the target at the corner nearest the caster and sprays *away* from them. Off-board and intact-obstacle squares are skipped (an obstacle blocks the sprayed square; obstacles are otherwise unaffected). Aimed-AOE hits all enemies in the block (cost paid once; each victim caught mid-Special takes the crit) **respecting LOS from the caster** — an obstacle between the caster and a victim shields them. slow tiles add +1 leave-cost in `movement.ts`. **Aimed vs reactive AOE:** an *aimed* (`Aimed: true`) area attack blasts the N×N centered on the chosen target tile; a *reactive* (`Aimed: false`) area attack is a **self-centered burst** — the N×N around the actor's own square (a melee smash, no target tile). Both share `resolveAoeStrike` in `resolution.ts`.
- **`Smash: true`** is a rider on an Area strike: it flattens every obstacle in the block *first* (so the levelled cover stops shielding), then the blow lands through the opened LOS. Lets a heavy attack tear through terrain instead of being blocked by it (Melbear's Ursa Minor). Costed in `cost_report.ts` as ~0.5 per area square (zero at area 1, never on crits).
- Board-effect types (9+) are the 0.2.0 positional layer (**implemented**): 9/10 drop a permanent tile on the caster's square (allies standing on it gain block/buff each round — applied at action-phase start; buff feeds `CombatantState.tileBuff` into strike damage); 11 drops a tile that damages opposing units that *enter* it (checked in the move phase); 12 targets an obstacle in range, destroys it, and AOEs its field to enemies within 1. Tiles live on `Board` (`setTile`/`getTile`, serialized via `board.toJSON().tiles`); resolution hooks in `resolution.ts`; tile/obstacle targeting via `ActionInfo.targetsObstacle` in `public/game.js`. Tile actions: `src/weapon/action/tile_action.ts`, `destroy_obstacle.ts`.
- Action templates use placeholders: `<User>`, `<Target>`, `<Damage>`
- `Aimed: false` is the in-game term **reactive** — attack fires without targeting a specific tile
- `Aimed: true` is the in-game term **aimed** — player selects a target tile before the attack resolves

## Current System: Spatial Web Combat

The active combat system is the spatial grid-based web server in `src/server/index.ts` + `src/combat/`. The old Discord bot and turn-based engine have been **archived** to `archive/` (excluded from the build) — see `archive/README.md`. If a Discord front-end is rebuilt, it should drive the new spatial system, not the archived `battle.ts`.

Key files for the new system:
- `src/server/index.ts` — Express + Socket.io server, session management, test session setup
- `src/combat/combat_session.ts` — Session container, serializable state for the UI
- `src/combat/resolution.ts` — Turn resolution: move phase → action phase → cleanup
- `src/combat/action_resolver.ts` — Stateless action execution (strike, DOT, debuff, etc.)
- `src/combat/ai.ts` — AI intent dispatch: smart units → `choosePlan`, others → the Pattern walk
- `src/combat/ai_planner.ts` — Utility AI: scores `(destination, action, target)` plans each turn (`choosePlan`). Behaviour (kite/smash/heal/control) emerges from the kit + HP; no per-enemy scripts. Opt in per enemy with `AI: smart` in the YAML. `predictPlayerTiles` models where the player will move so aimed attacks *lead* and AOE *blankets*. Pass a `collect` array to record every candidate's score (powers the replay).
- `src/combat/replay_sim.ts` — Shared spatial-sim core: `genBoard`, `buildPlayerUnit`, and `generateReplay(weapon, enemy)` (one battle + full per-turn AI trace). Used by both the CLI and the dev API.
- `src/tools/spatial_sim.ts` — Headless spatial sim: real engine + `choosePlan` driving **both** sides over real boards. `node lib/tools/spatial_sim.js [N] [enemy]` prints a win%/rounds/HP/timeout table (grades positional kits the non-spatial `simulate.ts` can't). `... debug <enemy> <weapon>` traces one battle; `... replay <enemy> <weapon>` writes `public/replay.json`.
- **Dev AI replay** — a dev-tab view (`/dev/replay` → `public/views/dev_replay.js`) that generates a battle live via `/api/dev/replay?weapon=&enemy=` (isDev-gated) and steps through it turn-by-turn: the board like a real fight, the predicted-movement heatmap (a unit's expected foe-movement = its dodge space), and every scored candidate plan with the chosen one highlighted. Toggle which unit's reasoning to inspect.
- `src/combat/enemy_loader.ts` — Loads enemy YAML into Combatant + CombatantMeta
- **Enemy telegraph** (`computeTelegraph` in `src/server/index.ts`) — a deliberately vague, movement-keyed *body-language* cue (closing/holding/fleeing) that correlates with intent but never reveals the action category; reading attack-vs-heal-vs-trap is the player's job. Enemies can define flavored phrases per movement intent via a `Telegraph:` block in their YAML (`closing`/`holding`/`fleeing`), else a generic mood is used.
- `public/` — Browser UI (game.html, game.js, game.css)

**Crit rule (category triangle):** Defend ▶ Attack ▶ Special ▶ Defend. A dedicated post-action pass, `resolveTriangleCrits` (`resolution.ts`), runs after the action sub-phases: every unit whose action category BEATS an opposing unit's gets its matching crit fired at that foe.
- **attack → special:** `attack_crit`   • **special → defend:** `special_crit`   • **defend → attack:** `defend_crit` (the defender ripostes the attacker).

A crit is **one payload per category per weapon** (a single `attack_crit`/`special_crit`/`defend_crit` list that rides ANY action of that category) and is just a `resolve_action`, so it can be any type — a strike riposte, extra block, a debuff. It fires regardless of the main action's type (a self-target shield still crits a guard). **Range-gated:** the crit reaches `max(crit.Range, the-used-action's range)`, so a melee riposte can't catch a ranged attacker, while an attack-crit reaches whoever your attack hit. Crits skip a dead target. The budget (`budget.ts`/`cost_report.ts`) costs all three crit lists at **0.4×** (they're conditional — only on a correct, in-range counter).

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

### Stances (removed — code deleted)
Were: Defensive / Balanced / Aggressive (D/B/A), which set a roll mode via a
`resolve_roll_mode()` matchup table. Removed because spatial movement + targeting
gives equivalent skill expression without a separate stance layer. The code is
**gone** (`stance.ts` deleted; the old `Non_Player_Character` class that carried
`Stance_Pattern` archived). The `RollMode` enum it shared with the resistance
system was extracted to `src/infrastructure/roll_mode.ts` — that's still live.

### Damage Types & Resistances (active)
Every action has `Damage_Type` (Arcane / Physical / Elemental) and `Damage_Subtype` (Mental / Sharp / Blunt / Poison / etc.). Enemies have `Resistances` as multiplier scores (e.g. `Sharp: 1.25`, `Mental: 0.75`). Type and subtype scores multiply together, then map to a **roll mode** rather than a flat damage multiplier:

- combined score > 1.0 → **weakness** → Hd4 (roll 4 dice, take highest — big variance, skews high)
- combined score < 1.0 → **resist** → Ld2 (roll 2 dice, take lowest — skews low)
- combined score = 1.0 → **neutral** → 1d (single roll, baseline)

This means type matchups affect the *shape* of the damage roll, not a predictable percentage. A weakness doesn't guarantee more damage — it skews the odds dramatically. Log shows `[weakness — Hd4]` or `[resist — Ld2]` when active.
