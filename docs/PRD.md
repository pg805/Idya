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

## Architecture

### Hybrid Approach

| Layer | Platform | Responsibilities |
|-------|----------|------------------|
| Social/Commands | Discord | Slash commands, trading, chat, notifications, customization display |
| Gameplay | Web App | Battles, crafting UI, inventory management, detailed character view |

### Tech Stack

- **Language**: TypeScript
- **Discord**: discord.js v14
- **Web Backend**: Node.js/Express (or Fastify)
- **Web Frontend**: TBD (React, Vue, or vanilla - decide based on complexity needs)
- **Database**: PostgreSQL (recommended for economy/trading queries) or SQLite for simplicity
- **Hosting**: Ubuntu VM on Proxmox (1TB SSD, 32GB RAM available)

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
- Single character per account (for MVP)
- Persistent inventory, currency, and specialty levels
- Basic stats: HP, currency balance, specialty XP/levels

### 2. Battling System

- **Location**: Web app
- **Flow**: `/battle` command in Discord → link to web battle → results post to Discord
- **Mechanics**: Turn-based, weapon/action system (existing foundation)
- **Enemies**: PvE with loot tables
- **Rewards**: Currency + crafting components (random drops)
- **Skill expression**: TBD - exploring telegraphing, resource management, or other approaches

**MVP Enemies**: 3-5 enemy types with varying difficulty and loot tables

### 3. Smithing (Crafting System 1)

- **Purpose**: Create weapons and armor
- **Inputs**: Ore, ingots, components from battles
- **Outputs**: Equipment usable in combat
- **Progression**:
  - Low levels: cheap to unlock, basic recipes
  - High levels: expensive to unlock, powerful recipes
- **UI**: Web-based crafting interface

**MVP Recipes**: 5-10 basic weapons/armor pieces

### 4. Enchanting (Crafting System 2)

- **Purpose**: Enhance equipment with bonuses
- **Inputs**: Enchanting materials (battle drops, possibly from smithing byproducts)
- **Outputs**: Stat boosts, special effects on weapons/armor
- **Progression**: Same cheap-to-start, expensive-to-master model
- **Dependency**: Requires smithed items to enchant (creates trade demand)

**MVP Enchantments**: 3-5 basic enchantment types

### 5. Trading

- **Location**: Discord commands
- **Mechanics**: Player-to-player direct trades
- `/trade @user [item] [quantity] for [price]` - propose trade
- Other player confirms or rejects
- **Safety**: Confirmation step, trade log

**Marketplace**: Deferred post-MVP

### 6. Inventory & Currency

- **Currency**: Single currency (name TBD)
- **Inventory**: Items, equipment, crafting materials
- **Viewing**:
  - Discord: `/inventory` shows summary
  - Web: Full inventory management UI

### 7. Cosmetic Customization

- **Scope for MVP**: Character title/name display, basic profile customization
- **Future**: More cosmetic options as systems mature

---

## Specialization System

### Leveling Model

```
Level Cost Curve (example):
Lv 1-10:   100 currency per level (1,000 total)
Lv 11-20:  500 currency per level (5,000 total)
Lv 21-30:  2,000 currency per level (20,000 total)
...escalating
```

This allows:
- Everyone to dabble in everything at low cost
- Dedicated specialists to reach high-tier recipes
- Multiclassing possible but requires significant investment

### MVP Specialties

1. **Smithing** - weapons, armor
2. **Enchanting** - equipment enhancement

### Future Specialties (Post-MVP)

- Farming - consumables, potion ingredients
- Lumberjacking - building materials, weapon handles
- Mining - ore for smithing
- Cooking - buff foods
- Alchemy - potions

---

## Discord Commands (MVP)

| Command | Description |
|---------|-------------|
| `/battle` | Start a battle (returns web link) |
| `/inventory` | View inventory summary |
| `/balance` | Check currency |
| `/trade @user [offer]` | Propose a trade |
| `/craft` | Open crafting interface (returns web link) |
| `/profile` | View character profile |
| `/profile set [option]` | Customize profile |
| `/specialties` | View specialty levels and costs |
| `/learnspecialty [name]` | Invest in a specialty level |

---

## Web App Pages (MVP)

| Page | Purpose |
|------|---------|
| `/battle/:sessionId` | Battle interface |
| `/craft` | Crafting UI for all unlocked specialties |
| `/inventory` | Full inventory management |
| `/character` | Detailed character view and customization |

---

## Database Schema (High-Level)

### Core Tables

- **users**: discord_id, created_at, currency
- **characters**: user_id, name, title, hp, cosmetic_options
- **specialty_levels**: character_id, specialty_type, level
- **inventory**: character_id, item_id, quantity
- **items**: id, name, type, rarity, stats, tradeable
- **recipes**: id, specialty, required_level, inputs[], output
- **trade_log**: id, from_user, to_user, items, currency, timestamp

---

## Economy Flow (MVP)

```
Battles → Currency + Components
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
Smithing            Enchanting
(components →       (materials +
 weapons/armor)      smithed items →
    ↓                enhanced gear)
    └─────────┬─────────┘
              ↓
         Trading
    (specialists trade
     outputs for inputs
     they can't make)
```

---

## Open Questions / TBD

| Area | Question |
|------|----------|
| Combat | How to make it skill-based rather than random? (telegraphing, resource mgmt, etc.) |
| Currency | Name? |
| Marketplace | Auction house vs. listing board vs. neither? |
| Web Frontend | React, Vue, Svelte, or vanilla? |
| Database | PostgreSQL vs. SQLite? (Postgres recommended for complex queries) |
| Session Auth | JWT tokens? Session cookies? |
| Battle Balance | Enemy scaling, loot table rates |
| Crafting Balance | Recipe costs, specialty level requirements |

---

## Future Features (Post-MVP)

- **PvP Battling**: Arena system, rankings
- **Marketplace**: Searchable listings, auction functionality
- **Guilds**: Group bonuses, shared storage
- **More Specialties**: Farming, mining, cooking, alchemy, etc.
- **Quests**: NPC-driven objectives
- **Events**: Time-limited content, seasonal items
- **Mobile**: Responsive web or dedicated app

---

## Success Metrics (MVP)

- Players can battle and receive loot
- Players can craft basic items via smithing
- Players can enchant smithed items
- Players can trade items/currency with each other
- Economy creates natural demand for trading between specialists
- System is extensible for new specialties and features

---

## Technical Requirements

### Server Allocation (Suggested)

- **VM**: Ubuntu 22.04 LTS
- **RAM**: 4-8GB should be plenty for MVP
- **Storage**: 20-50GB (database + logs + application)
- **Services**: Node.js process manager (PM2), PostgreSQL/SQLite, Nginx reverse proxy

### External Dependencies

- Discord Bot Application (existing)
- Discord OAuth application (for web auth)
- Domain name (optional but nice for web links)

---

*Last updated: January 2026*
