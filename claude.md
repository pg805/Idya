# Idya - Discord RPG Battle Bot

## Overview

Idya is a web + Discord RPG battle bot (0.2.0 dev). Players engage AI-controlled enemies on a spatial grid through the web SPA (the live system); combat, crafting, upgrades, enchants, and a market all run off the Express + Socket.io server.

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
- Spatial grid combat (move phase → action phase → cleanup), per-round resolution for all units.
- Action types: see the Action type IDs list under Conventions (1–14: strike, block, buff, DOT, debuff, heal, reflect, shield, tiles, destroy-obstacle, move-debuff).
- Damage modifiers apply in order: buffs → debuffs → blocks → shields; type/subtype matchups skew the roll *mode* (see Damage Types & Resistances).

### Weapons
14 weapon YAMLs in `database/weapons/` (12 craftable + `branch` starter + `honor` the OP test toy — **do not touch honor**). Each has 6 action sets (Defend, Defend Crit, Attack, Attack Crit, Special, Special Crit) and a `Level` (1–5). Loaded by `Weapon.from_file`.

### Enemies
10-enemy roster (+ `tutorial_swallow`) in `database/enemies/`, levels 0–6: tinpul/lithkem_swallow (L0), sulfolk/talwyrm (L1), daefen_deer/maetoad (L2), golnosar (L3), melbear (L4), child_of_sidaev (L5, arcane glass cannon), sulgovenath (L6, sword-wielding sulfolk bruiser — final boss). L5/L6 are endgame fodder for upgraded+enchanted players; base weapons are meant to lose. Pattern AI (`[type, area]` steps) or `AI: smart` for the utility planner. The archived rat/zombie/mushroom are gone.

### Front-end
The live system is the web SPA (`public/`) on the Express + Socket.io server. The old Discord slash-command bot (`/demobattle` etc.) is **archived** (`archive/`) — if rebuilt, it should drive the spatial system, not the old engine.

## Important Classes

- `Combatant` / `CombatantMeta` (`src/combat/combat_session.ts`) - Live unit + its weapon/state/AI pattern
- `resolveIntents` (`src/combat/resolution.ts`) - Core turn resolution (move → action → cleanup)
- `CombatSession` (`src/combat/combat_session.ts`) - Session container + serializable state
- `Weapon` (`src/weapon/weapon.ts`) - Weapon loading from YAML
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

Each weapon belongs to **one** crafting profession (`WEAPON_PROFESSION` in `upgrade_service.ts`), and you only **upgrade your own profession's** weapons:

| Profession | Crafts / upgrades |
|------------|-------------------|
| Lumberjack (LJ) | axe_wood, sword_wood, shovel_wood, kustaff |
| Blacksmith (BS) | pickaxe, dagger, mace, battle_axe |
| Enchanter (EN) | deck_of_cards, spellbook, mental_cage, wand |

**Enchanting** (the 4-type enchant layer) is a separate thing the Enchanter does to *any* weapon — gated by weapon level vs Enchanter rank, not by which profession crafted it (see Enchant rules).

### Upgrade Slots (per profession rank)
A weapon's max upgrades is gated two ways: by your profession Rank via `UPGRADE_BUDGET` (slots unlocked per rank) and by the weapon via `maxUpgrades(baseLevel) = 3·(5 − baseLevel)` (3 upgrades per level above its base, up to L5).

```
Rank:   0  1  2  3  4  5  6  7  8  9  10
Slots:  0  0  1  1  3  3  6  7  9  9  12
```

Each upgrade auto-adds HP + gives EV points (a "point" = +1 EV); the HP:EV split is **per-weapon** (`hpBudgetRatio` — glass cannons get more EV, tanks more HP). Per-upgrade value by the level it climbs: L1→L2 = 25, L2→L3 = 33, L3→L4 = 42, L4→L5 = 50 EV. See `upgrade_service.ts` (`upgradePointValue`, `upgradeSplit`).

### Upgrade Costs
`upgradeCost(n, profession, baseLevel)`, keyed to the level climbed: per-band base `UPGRADE_COST_BAND = [5, 10, 5, 12]` (L1→L2 / L2→L3 / L3→L4 / L4→L5) + position (+0/+1/+2) → **5/6/7, 10/11/12, 5/6/7, 12/13/14**. Tier-2 material climbing to L2/L3, tier-3 to L4/L5. Tier-3 smelt is **12:1** off tier-2, so the L4/L5 counts are small but dear. Max an L1 weapon ≈ 7,350 raw-equiv (BS ~165 / EN ~236 / LJ ~399 farm-wins; tune via `pacing_sim.ts`). You only upgrade your **own** profession's weapons.

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
| 3 | Sulwood Sword + Shovel (L2) | Dagger + Mace (L2) | Spellbook, Mental Cage (L2) |
| 4 | — (budget) | — (budget) | — (budget; can now enchant **L2** weapons) |
| 5 | Kustaff (L3) + **Battle Axe Hilt** | Battle Axe (L3) + **Wand Base** | Wand (L3) + **Staff Base** |
| 6 | — (budget) | — (budget) | — (budget; can now enchant **L3** weapons) |
| 7 | Hardwood (smelt) | Alloy (smelt) | Nodol (smelt) |
| 8 | — (budget) | — (budget) | — (budget; can now enchant **L4** weapons) |
| 9 | **Crossbow (L4)** + crossbow_limb buy | Nunchaku (L4, TBD) | Scythe (L4, TBD) |
| 10 | — (budget) | — (budget) | — (budget; can now enchant **L5** weapons) |

**L3 cross-profession components (rank 5).** Each L3 weapon needs a `base`/`hilt` component crafted by a *different* profession — a dependency triangle: **Wand** (EN) ← `wand_base` (BS, 10 talamite); **Kustaff** (LJ) ← `staff_base` (EN, 10 hiruos); **Battle Axe** (BS) ← `battle_axe_hilt` (LJ, 10 treated_sulwood). Components are craft-gated at rank 5 but freely **buyable/sellable** at the maker's shop, so you craft your weapon with a 2nd profession or trade for the part. (Replaced the old per-tier blade/head/handle components, which were dead cruft sold in shops.)

**L4 cross-profession weapons (rank 9).** Each L4 weapon needs **two bespoke tier-3 parts** from the *other two* professions plus its own — deeper interdependency. **Crossbow** (LJ) = `crossbow_limb` (BS, 2 alloy) + `magic_bolts` (EN, 2 nodol) + 2 hardwood; **Nunchaku** (BS, TBD) and **Scythe** (EN, TBD) follow the same pattern. Components craft-gated at R9, buyable at the maker's shop; the L4 weapon itself is **craft-only** (the assembly is the point). Crossbow stats: 190 HP, budget L3.94 (ranged kit reads low; plays L4) — ranged kiter with a 2×2 Exploding Shot + 3×3 web-slow. Sim: stomps L3, ~67% vs melbear (L4), counters the L5 Child via its Physical weakness, loses to Sulgovenath (L6).

(Enchanting unlocks by **weapon level vs Enchanter rank** — rank ≥ 2× level, so L1 weapons enchantable at R2 — not via per-rank recipes. See Enchant rules below.)

**Enchant rules (0.2.0 rework — `src/economy/enchant_service.ts`, its own layer separate from upgrades):** 3 slots per weapon, permanent, each enchant takes a slot. Four types, each once per weapon (the `upgrade` enchant is once **per ability**). All values scale off the level budget `CAP(L)` and are static within a level. Power sits **on top of** the weapon budget (that's why it costs slots + materials).
- **health** — flat HP by weapon level (0.25·CAP → 13/31/56/88/125).
- **melee** — injects the **Sidaev Strike** ability (Arcane/Blunt, range 1, cost 1, reactive, Attack-category). Field ≈ 5%·CAP per level.
- **ranged** — injects the **Sidaev Pulse** ability (Arcane/Sharp, range 2, cost 1, reactive, Attack-category). Field ≈ 3.5%·CAP (lower than melee).
- **upgrade** — adds a set EV (0.06·CAP → 3/8/14/21/30) to one ability + an **optional** damage-type change (any type/subtype, no category gating). Mirrors the old enchant's per-ability EV but level-scaled.

Applied via `/api/enchant` (GET lists per-weapon previews; POST `{type, action?, delta?, damage_type?, damage_subtype?}`). Combat injection in `applyWeaponCustomizations` (`src/server/index.ts`): health adds HP, melee/ranged push a `buildSidaevAction` Strike into `weapon.attack`, upgrade rides the action's field/value + retype.

**Rank gate + cost (`enchant_service.ts`):** you can enchant a weapon once Enchanter rank ≥ **2× its level** (`enchantRankRequired` — L1 at R2, L2 at R4, L3 at R6, L4 at R8, L5 at R10); **all four types unlock together** for that level (no per-type gate). **Cost** scales with weapon level (`enchantCost`): L1 5 / L2 10 / L3 20 hiruos, L4 3 / L5 5 nodol. Enchants are **not recipes** — applied via the Enchant page, not crafted (the old physical/arcane/elemental enchant recipes were removed from `enchanter.yaml`).

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
- **Melbear (L4)** is the most discriminating matchup — use it to separate weapon tiers. (Spatial combat balance lives in `spatial_sim.ts`; the non-spatial `simulate.ts` undervalues ranged kits. `pacing_sim.ts` is the **economy** sim — fights-to-rank + material throughput, not combat.)
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
