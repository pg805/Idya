# Changelog

## 0.0.3 — 2026-05-29

### Features
- **Batch crafting** — quantity input on craft button (1–99), runs in a single transaction with one Discord ping
- **Crafting page train buttons** — Train Lumberjack / Blacksmith / Enchanter buttons with korel indicator directly on the crafting page
- **Discord activity pings** — buys, sells, crafts, and weapon upgrades now post to the relevant shop/profession channel
- **Weapon upgrade pings** — upgrade actions post to the profession's channel
- **Bot lifecycle notifications** — bot_log admin channel receives a message on startup (with commit hash), graceful shutdown (SIGTERM), crash (with stack trace), and unhandled rejections
- **Profession levels on `/profile`** — profile embed now shows Lumberjack, Blacksmith, and Enchanter levels
- **Tree favicon** — pixel art tree icon on all web pages
- **Dev tab title suffix** — pages on port 3000 show "— Dev" in the browser tab

### Fixes
- **Upgrade panel broken** — render was referencing non-existent field names (`w.at_cap`, `w.budget`, `w.next_cost`); now uses correct API fields (`weapon_total`, `weapon_cap`, `upgrade_professions`)
- **Upgrade locked message** — "Reach level 4 to unlock weapon upgrades" now appears correctly when weapon cap is 0
- **Give item / craft FK error** — crafted-only items (treated_sulwood etc.) now upsert the `Item` row from the `ITEMS` map so they work in `/admin giveitem` and don't hit a foreign key error on craft
- **Lumberjack missing from shop map** — `/shop` in the lumberjack channel was returning "no shop here"
- **Train button in wrong shop** — lumberjack training was mapped to the general store; moved to the lumberjack shop
- **Train button label** — buttons now read "Train Lumberjack" / "Train Blacksmith" / "Train Enchanter" instead of generic "Train"
- **Webhook 404 on dev deploys** — `pm2 restart webhook` was causing a brief downtime window; changed to `pm2 reload` for zero-downtime restart

---

## 0.0.2 — 2026-05-28

### Features
- **Nationality dropdown** — character creation now uses a Chae / Ketulvu select menu instead of a text input
- **Trenton Steelhammer** — replaces Dazzle in the default sprite selection

### Fixes
- **Shop NaN crash** — general store (and any shop with `volume_sensitivity: 0`) was returning 500 due to `0/0 = NaN` propagating into a Prisma `updateMany` call; guarded in `currentR`
- **Penni sprite** — Discord media proxy had cached the wrong image; fixed by renaming the sprite key to `penni-cold` (new URL forces a fresh fetch)
- **Deploy reliability** — replaced `git pull` with `git fetch + git reset --hard` so local file differences never block deployment; added `flock` to serialize concurrent webhook deploys
- **Prod deploy pipeline** — `deploy-prod.sh` is now called from the prod repo (`Idya-prod`) so the prod pipeline is independent of the dev repo; both scripts are invoked with `bash` so the execute bit is never required
- **Webhook concurrent deploys** — changed from non-blocking `flock -n` (dropped deploys silently) to blocking `flock` (queues and runs all pushes in order)

---

## 0.0.1 — Alpha

> Initial Alpha release. Shipped as version Alpha-1.0 internally.

### Combat System
- **Spatial grid combat** — turn-based battles on a tile grid with movement, collision, and line-of-sight; browser UI served via Express + Socket.io
- **Action types** — Strike, Block, Buff, Debuff, Heal, DOT, Reflect, Shield; aimed (player selects target tile) and reactive (fires without targeting)
- **Crit system** — `attack_crit` fires when the attacker uses Attack and the target is using Special the same turn
- **Damage types & resistances** — Physical / Arcane / Elemental with subtypes; enemy resistances shift the damage roll mode (Hd4 weakness, Ld2 resist, 1d neutral)
- **Resource costs** — actions consume and restore stamina/resource; AI and player both governed by the same rules
- **AI pattern engine** — enemies follow repeating pattern sequences (Defend / Attack / Special); reroutes around blocked tiles
- **Telegraph system** — shows the enemy's intent each turn based on their pattern and position

### Enemies
- 5 enemies: **Lithkem Swallow**, **Sulfolk**, **Talwyrm**, **Daefen Deer**, **Maetoad** — each with unique weapons, patterns, resistances, and loot tables

### Weapons
- **Starter:** Branch
- **Lumberjack:** Quarterstaff, Bow, Sword (wood), Axe (wood), Shovel (wood), and hardwood variants of each
- **Blacksmith:** Dagger, Mace, Wand (talamite), and talamite/alloy variants
- **Enchanter:** Kustaff, Spellbook, Deck of Cards, Mental Cage
- **Special:** Honor
- All weapons have 6 action sets (Defend, Defend Crit, Attack, Attack Crit, Special, Special Crit)

### Discord Integration
- **`/hunt`** — start a battle from a bait item in your inventory; links to the browser UI
- **`/createcharacter`** — modal flow: name → bio → nationality (text input) → sprite picker
- **`/profile`** — shows HP, korel, equipped and owned weapons, inventory
- **`/weapon`** — equip a weapon you own
- **`/shop`** — opens the web shop UI for the channel you're in
- **`/craft`** — opens the crafting/upgrade web UI
- **`/ping`** — pong
- **Tutorial** — scripted first battle against a weakened Lithkem Swallow with Fendalok; unlocks the forest on completion
- **Welcome flow** — ephemeral join embed with a button to post publicly to town square
- **Battle result pings** — forest channel post on win (loot summary) or loss (healing fee)
- **Admin commands** — `/admin givekorel`, `giveitem`, `giveprofession`, `giveweapon`, `resetcharacter`, `joinsim`, `setprofession`

### Economy
- **Shops** — General Store, Blacksmith, Lumberjack, Temple, Enchanting Shop; each with an NPC and greeting
- **Dynamic pricing** — logistic map price model; prices shift with buy/sell volume and stock levels
- **Professions** — Lumberjack, Blacksmith, Enchanter; each levels 1–10, combined cap of 30; trained at their respective shops
- **Crafting** — recipe trees for all three professions; material intermediates (sulwood, talamite, hiruos) and weapon assembly
- **Weapon upgrades** — Craft/Upgrade tab; per-action field and value upgrades; budget unlocks at level 4, scales to level 10; upgrade costs in tier-2/tier-3 materials
- **Enchanting** — minor enchants (subtype only) and major enchants (type + subtype); 3 slots per weapon; applied via `/api/enchant`
- **Korel** — currency with full ledger; earned from battles, spent at shops and on upgrades; 10% healing fee on defeat
- **Inventory** — items persist per character; shop stock tracked per shop

### Characters & World
- **Character persistence** — PostgreSQL via Prisma; one character per user
- **Sprites** — Asterius, Penni, Trenton Steelhammer, Lone Climber, and others; render on the battle grid token
- **Nationality** — Chae / Ketulvu (lore-backed)
- **NPCs** — Fendalok (Padev), Dolan (General Store), Kethalis (Blacksmith), Vetha (Lumberjack), Lithona (Temple), Lomis (Enchanter); each with character lore
- **World config** — dev/prod split; guild IDs, channel IDs, admin roles, NPC definitions in `world.json`

### Infrastructure
- **Deploy webhook** — GitHub webhook triggers `deploy.sh` / `deploy-prod.sh` via pm2; dev and prod run as separate pm2 processes on the same host
- **Cloudflare tunnel** — `idya.slowb.rodeo` routes to prod (port 3001); dev accessible on local network (port 3000)
- **Dev/prod config split** — `NODE_ENV=production` selects prod guild, channels, and bot token
- **Audit logs** — `KorelLedger`, `BattleLog`, `EventLog` tables track all economy and combat events
