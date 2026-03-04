# Idya PRD - Discord RPG Bot

## Vision

Idya is a text-based RPG with an economy-driven design where players specialize in crafting systems and trade to progress. Discord serves as the social and command layer while a web app handles complex interactions like battles and crafting.

## Design Principles

1. **Economy-first**: Every system exists to create supply, demand, and trade opportunities
2. **Specialization matters**: Players can multiclass but depth rewards focus
3. **Cooperation over competition**: Trading and interdependence are core loops
4. **Accessible battling**: Everyone can battle for resources regardless of specialty
5. **Room to grow**: Architecture supports adding new systems without rewrites

---

## Core Game Loop

**Battling is the resource tap.** Every player can fight monsters to earn currency and raw materials regardless of their profession. This is the entry point for all economy activity.

**Professions are how you spend those resources.** Every player has access to all professions, but leveling them becomes exponentially more expensive — encouraging specialization and creating trade demand between players.

**Crafting is the output.** At each profession level, players unlock new recipes and do a web-based minigame to craft items. Weapon-producing professions let players build and customize weapons for use in battle. Feeder professions produce raw materials that other professions need.

**Trading closes the loop.** No profession is self-sufficient at high levels. A smith needs ore from a miner and handles from a lumberjack. An enchanter needs smithed weapons. This interdependence makes trading between specialists the natural path to progression.

```
Battles → Currency + Raw Materials
              ↓
    Spend on profession levels or buy materials
              ↓
    Do profession minigame → craft items
              ↓
    Use crafted weapons in battle  ←→  Trade with other specialists
```

---

## Profession System

### Weapon-Producing Professions

These professions produce weapons usable in combat. Crafted weapons come from the player's inventory — the weapon equipped in battle is always a crafted item (not a hardcoded demo weapon).

| Profession | Weapon Outputs | Notes |
|---|---|---|
| **Smithing** | Swords, axes, knives | Core weapon profession, needs ore + handles |
| **Enchanting** | Wands, staves, weapon upgrades | Upgrades apply to existing weapons; also serves as a tutorial for non-weapon professions |

### Feeder Professions

These professions produce raw materials and consumables that other professions depend on. They don't produce weapons directly but are essential to the economy.

| Profession | Outputs | Feeds Into |
|---|---|---|
| **Mining** | Ore, ingots | Smithing, Enchanting |
| **Lumberjacking** | Wood, handles, shafts | Smithing, Alchemy |
| **Farming** | Herbs, ingredients | Alchemy, Cooking |
| **Alchemy** | Potions, poisons | Battle consumables, Enchanting |
| **Cooking** | Buff foods | Battle consumables |

### Leveling Model

Every player starts at level 0 in all professions. Leveling cost escalates to reward specialization and make true multiclassing expensive.

```
Cost curve (TBD — needs balancing):
Lv 0→1:    cheap (accessible to all)
Lv 1→10:   moderate
Lv 10→20:  significant
Lv 20→30:  expensive
...escalating steeply
```

- Total cost to reach lv 10 in one profession should be achievable solo through moderate battle effort
- Total cost to max two professions should require meaningful trade/grind tradeoffs
- Spreading across all professions should be theoretically possible but economically punishing

### Weapon Customization

Weapons are not fixed templates — they are crafted instances with customizable actions and damage. A smith, while crafting, selects from an action pool based on their level and available materials. An enchanter can modify an existing weapon's damage rolls or change its damage type.

- **Base weapon**: defines the slot structure (defend, attack, special sets) and stat ranges
- **Action pool**: smith selects specific actions within each slot from level-gated options
- **Enchanting layer**: modifies damage values or damage types on an already-crafted weapon
- All crafted weapons are stored in the database as instances, not templates

---

## Architecture

### Hybrid Approach

| Layer | Platform | Responsibilities |
|-------|----------|------------------|
| Social/Commands | Discord | Slash commands, trading, chat, notifications, customization display |
| Gameplay | Web App | Battles, crafting minigames, inventory management, detailed character view |

### Tech Stack

- **Language**: TypeScript
- **Discord**: discord.js v14
- **Web Backend**: Node.js/Express (or Fastify)
- **Web Frontend**: TBD (React, Vue, or vanilla - decide based on complexity needs)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Hosting**: Proxmox — Ubuntu VMs on local server (1TB SSD, 32GB RAM)

### Server Layout

```
10.0.0.50  — Cloudflare tunnel VM
10.0.0.51  — Database VM (PostgreSQL)
10.0.0.52  — App VM (bot + web app, TBD)
```

Cloudflare handles DNS, SSL termination, and external routing. No separate reverse proxy VM needed.

### Data Flow

```
Discord Command → Bot → Backend API → Database
                           ↓
Web UI ←→ Backend API (WebSocket for battles)
                           ↓
Battle Result → Bot → Discord Channel
```

---

## MVP Scope

### 1. Player Accounts

- Discord OAuth links Discord user to game account
- Single character per account (for MVP; multiple characters planned post-MVP)
- Persistent inventory, currency, and profession levels
- Basic stats: HP, currency balance, profession levels

### 2. Battling System

- **Location**: Web app (Discord demo battle kept as tutorial/reference)
- **Flow**: `/battle` command → web session → results posted back to Discord
- **Mechanics**: Turn-based with stances, weapon/action system, resource management, NPC telegraphing
- **Enemies**: PvE with loot tables dropping currency and crafting materials
- **Rewards**: Currency + raw materials (specific drops TBD per enemy)
- **Skill expression**: Stance reads, pattern recognition, resource management
- **Weapons**: Player's equipped weapon comes from their inventory (crafted item)

**Full design spec**: See [`docs/battle-system.md`](./battle-system.md)

**MVP Enemies**: 3-5 enemy types with varying difficulty and loot tables

### 3. Smithing

- **Purpose**: Craft swords, axes, and knives
- **Inputs**: Ore/ingots (from Mining or bought), handles (from Lumberjacking or bought)
- **Outputs**: Customized melee weapons with player-chosen action sets
- **Minigame**: Web-based crafting UI (design TBD)
- **Progression**: Level 1-10 for MVP

### 4. Enchanting

- **Purpose**: Craft wands and staves; upgrade existing weapons
- **Inputs**: Enchanting materials (battle drops), smithed weapons (for upgrades)
- **Outputs**: Magic weapons; enhanced versions of existing weapons
- **Minigame**: Web-based (also serves as a tutorial model for non-weapon professions)
- **Progression**: Level 1-10 for MVP

### 5. Trading

- **Location**: Discord commands
- **Mechanics**: Player-to-player direct trades
- `/trade @user [item] [quantity] for [price]` - propose trade
- Other player confirms or rejects
- **Safety**: Confirmation step, trade log

**Marketplace**: Deferred post-MVP

### 6. Inventory & Currency

- **Currency**: Single currency (name TBD)
- **Inventory**: Items, crafted weapons, raw materials
- **Viewing**:
  - Discord: `/inventory` shows summary
  - Web: Full inventory management UI

### 7. Cosmetic Customization

- **Scope for MVP**: Character title/name display, basic profile customization
- **Future**: More cosmetic options as systems mature

---

## Discord Commands (MVP)

| Command | Description |
|---------|-------------|
| `/battle` | Start a battle (returns web link) |
| `/demobattle` | Demo battle in Discord (tutorial/reference) |
| `/inventory` | View inventory summary |
| `/balance` | Check currency |
| `/trade @user [offer]` | Propose a trade |
| `/craft` | Open crafting interface (returns web link) |
| `/profile` | View character profile |
| `/profile set [option]` | Customize profile |
| `/professions` | View profession levels and upgrade costs |
| `/levelup [profession]` | Spend currency to level a profession |

---

## Web App Pages (MVP)

| Page | Purpose |
|------|---------|
| `/battle/:sessionId` | Battle interface |
| `/craft` | Crafting UI for all unlocked professions |
| `/inventory` | Full inventory management |
| `/character` | Detailed character view and customization |

---

## Database Schema (High-Level)

### Core Tables

- **users**: discord_id, created_at, currency
- **characters**: user_id, name, title, hp, cosmetic_options
- **profession_levels**: character_id, profession_type, level
- **inventory**: character_id, item_id, quantity
- **items**: id, name, type, rarity, tradeable
- **weapon_instances**: id, owner_character_id, base_type, actions (JSONB), enchantments (JSONB)
- **recipes**: id, profession, required_level, inputs[], output
- **trade_log**: id, from_user, to_user, items, currency, timestamp

---

## Economy Flow

```
Battles → Currency + Raw Materials
              ↓
    ┌─────────┬──────────┬──────────┐
    ↓         ↓          ↓          ↓
 Mining  Lumberjack  Farming   (direct purchase)
 (ore)   (handles)  (herbs)
    ↓         ↓          ↓
    └────┬────┘      Alchemy/Cooking
         ↓           (potions, buffs)
      Smithing              ↓
   (swords, axes,    Battle consumables
      knives)
         ↓
      Enchanting
   (wands, staves,
    weapon upgrades)
         ↓
      Trading
 (specialists trade
  outputs for inputs
  they can't produce)
         ↓
    Better weapons → Better battles → More resources
```

---

## Open Questions / TBD

| Area | Question |
|------|----------|
| Combat | Telegraphing depth per enemy tier — how much to reveal? |
| Currency | Name? |
| Marketplace | Auction house vs. listing board vs. neither? |
| Web Frontend | React, Vue, Svelte, or vanilla? |
| Session Auth | JWT tokens? Session cookies? |
| Battle Balance | Enemy scaling, loot table rates |
| Crafting Balance | Recipe costs, profession level requirements |
| Profession costs | Cost curve needs proper balancing pass |
| Minigames | What does each profession's crafting minigame actually look like? |
| Enchanting upgrades | Exactly what parameters can be modified and within what ranges? |

---

## Future Features (Post-MVP)

- **Multiple characters**: Players can have more than one character per account
- **PvP Battling**: Arena system, rankings
- **Marketplace**: Searchable listings, auction functionality
- **Guilds**: Group bonuses, shared storage
- **Remaining professions**: Mining, Lumberjacking, Farming, Cooking, Alchemy
- **Quests**: NPC-driven objectives
- **Events**: Time-limited content, seasonal items
- **Mobile**: Responsive web or dedicated app

---

## Success Metrics (MVP)

- Players can battle and receive loot
- Players can craft weapons via Smithing and Enchanting
- Crafted weapons are usable in battle
- Players can trade items/currency with each other
- Economy creates natural demand for trading between specialists
- System is extensible for new professions and features

---

## Technical Requirements

### Server Allocation

- **DB VM** (`10.0.0.51`): Ubuntu 20.04, 2 cores, 2GB RAM, 40GB SSD — PostgreSQL 16
- **App VM** (`10.0.0.52`): Ubuntu, 2 cores, 2GB RAM, 16GB SSD — Node.js, PM2
- **Tunnel VM** (`10.0.0.50`): Cloudflare tunnel, existing

### External Dependencies

- Discord Bot Application (existing)
- Discord OAuth application (for web auth)
- Cloudflare (DNS, SSL, external routing) — domain: slowb.rodeo

---

*Last updated: March 2026 — infrastructure setup complete (DB + app server + auto-deploy)*
