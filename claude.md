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
├── weapons/             # Weapon JSON definitions
├── enemies/             # Enemy JSON definitions
└── players/             # (unused)
```

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
- Action type IDs: 1=Strike, 2=Block, 3=Buff, 4=Debuff, 5=Heal, 6=DOT, 7=Reflect, 8=Shield
- Action templates use placeholders: `<User>`, `<Target>`, `<Damage>`

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
