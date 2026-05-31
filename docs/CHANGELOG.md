# Changelog

## 0.1.0 — 2026-05-31

First major post-demo iteration. Web app SPA, unique weapon instances,
shopping cart, weapon selling, palette refresh, new info pages, and a
slash command per app tab. Driven by feedback from the 2026-05-30 demo
(see `docs/demo.md`).

### Web App
- **SPA navigation** — Character, Inventory, Shop, Upgrading, Enchanting, Professions, Enemies, and Weapon Stats now load as views inside a single shell. Sidebar selects views without full page reloads
- **Palette refresh** — new color system (Deep Space Blue background, Sunflower Gold titles, Jungle Teal positive, Cool Steel text, Dark Amaranth warning) wired through CSS variables in `layout.css`
- **Width consistency** — info/character/inventory pages capped at 1100px; shops expand to full width for side-by-side panels
- **Inventory page** — compact two-column grid with section headers (weapons / materials / consumables), equipped weapon highlighted with gold border, per-row upgrade badges
- **Character page** — restructured stats panel; equipped weapon shows `+N` upgrade count alongside the name
- **Info → Professions** — per-level unlocks listed for each profession (recipes, budget growth, enchant tiers)
- **Info → Enemies** — sidebar list + detail panel with HP, resistances, pattern, sprite, and raw drop tables

### Weapons as Unique Instances
- **Schema migration** — `CharacterWeapon` is now keyed by UUID instead of (character_id, weapon_key); `Character.equipped_weapon_id` is an FK with `ON DELETE SET NULL`. Players can own multiple instances of the same weapon
- **Recipe ingredients** — weapon-consuming recipes (e.g. Quarterstaff (Treated)) consume the oldest unequipped instance first; equipped weapon is never destroyed
- **Endpoints refactored** — inventory, character, upgrade, enchant, sell, and trade all operate on weapon instance IDs
- **`/weapon` capped at 25 options** — Discord StringSelectMenu hard limit; list is sorted equipped → bonus count desc, with a note when omitted

### Shopping Cart
- **Batched checkout** — buys, sells, weapon buys, and weapon sells all queue in a single sticky cart at the bottom of the shop page. One transaction, one Discord ping
- **Three-state total** — net total shows green (gain), grey (affordable cost), red (can't afford); checkout disables when red
- **Sticky panel** — cart pins to viewport bottom with sidebar offset; shop content pads automatically based on measured cart height
- **Weapon buying** — every buy creates a new `CharacterWeapon` instance, so duplicates are allowed
- **Weapon selling** — sell your weapons through the same cart, separated by a divider in the Sell panel. Confirm modal appears when selling ≥1 weapon. Upgrades and enchants do not raise sell price
- **Cart Discord ping** — bullet-list format, one item per line

### Slash Commands
- New slash command per app tab: `/character`, `/inventory`, `/upgrading`, `/enchanting`, `/professions`, `/enemies`. Each opens the user directly to its view in the web app
- `/weapon-stats` page now has profession filter checkboxes matching the craft page

### Shops
- **Intermediate materials in profession shops** — each profession's shop now buys and sells its tier-2 and tier-3 materials (Lumberjack: treated_sulwood, hardwood; Blacksmith: talamite, alloy; Enchanter: hiruos, nodol)
- **Weapon listings restored** — shops sell weapons again; each purchase creates a new instance
- **Stable item ordering** — shop item list no longer reshuffles when an item is added to the cart

### Enchanting
- **Enchanting tab on craft page** — full UI for applying enchants to weapons. Pick weapon → action → kind (minor/major) → category (physical/arcane/elemental) → subtype → distribute delta. Cost preview, material check, posts to enchanting channel on success
- **Actual roll display** — upgrade and enchant previews now show the new Field roll values instead of a generic range

### Infrastructure
- **Auto-announce on version bump** — when the bot starts on a new `package.json` version it hasn't announced before, it posts the matching changelog section to the `updates` channel and records the announcement in `EventLog` so it never reposts
- **Updates channel** — added to `world.json` for both prod and dev environments

### Fixes
- **`/weapon` failed with "Invalid string length"** — Discord caps `setDescription` at 100 chars; shortened the Wand description and added a defensive 100-char slice to all weapon options
- **Layout overflow clipping** — body was `overflow: hidden` with `app-shell: 100vh`, clipping content below the viewport. Changed body to a flex column so layout-root and app-shell stack correctly
- **"Need materials" badge** — looked like a featured item in gold; switched to the warn palette so it reads as a warning
- **Equipped weapon row invisible in inventory** — gold background tinted too close to dark navy; switched to a gold left-border with hover-tinted background
- **Enchanter upgrade materials** — `enchanting_reagent` / `refined_enchanting_reagent` placeholders replaced with actual items (`hiruos` and `nodol`) so enchanter weapon upgrades work

### Docs
- **Demo wrap-up doc** (`docs/demo.md`) — captures the 2026-05-30 demo session: player stats, economic curves, and full feedback list

---

## 0.0.4 — 2026-05-30

### Features
- **`/trade` command** — propose a trade with another player; both get a unique link to a shared trade page. Target receives a Discord DM with their link (falls back to a followUp if DMs are off)
- **Trade page** — real-time two-panel UI via Socket.io: select items and quantities from your inventory, see the other player's offer update live, lock in, and confirm. Swap executes atomically — both sides are validated in a single transaction
- **`/weapon-stats` command** — opens a public reference page (no auth required) listing all weapons with a full stat grid: action set, name, type, field array, cost, aimed/reactive, range, and damage subtype
- **Weapon stats grid** — single unified table with set column using rowspan, visible cell borders, crafting profession shown per weapon
- **Ingredient display names** — craft page now shows "Treated Sulwood" instead of `treated_sulwood`
- **Sprite CDN fix** — prod now pulls sprites from the `main` branch instead of `dev`
- **Battle round logging** — every turn's full action log is stored in `BattleRoundLog`, linked to the `BattleLog` entry; includes movement, actions, rolls, damage, and HP changes
- **Upgrade event tracking** — `EventLog` records every weapon upgrade with weapon, action, and profession
- **Trade event tracking** — `EventLog` records completed trades for both parties, including what was given and received

### Fixes
- **Webhook reload race condition** — `deploy.sh` now only reloads the webhook process when `webhook/index.js` actually changes; previously every dev deploy reloaded it, which opened a window where main push events could be handled by the old webhook process with stale code (causing prod deploys to silently fail with `Permission denied`)

---

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
