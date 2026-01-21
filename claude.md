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
