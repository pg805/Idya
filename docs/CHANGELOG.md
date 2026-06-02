# Changelog

## 0.1.2 — 2026-06-01

Trading moves into the web app, equip-from-inventory comes back, the
shop economy gets two real fixes (weapon sells were silently skipped,
items could soft-lock at cap), and prod deploys self-heal the
Cloudflare edge cache.

### Trade
- **Trade is an SPA view now** — the standalone `/trade/:id` page is gone. `/trade @user` in Discord still works and now links to `/app/trade/:id?auth=…`, which mounts the trade UI inside the app shell with the shared header + palette
- **Trade from inside the app** — new **Trade** sidebar entry. Typeahead search by character name (`GET /api/players?q=…`); pick a result → `POST /api/trade/start` → navigate to the trade session. The target gets a DM with their auth-laden link
- **Weapons and korel in the offer** — your offer panel now has three sections (Korel, Items, Weapons). Weapons are toggle buttons; equipped weapons grey out with "unequip to trade." Korel is a text input clamped to your balance in real-time. Server-side, the swap runs each transfer (items + weapons + korel) atomically inside the same Prisma transaction with `KorelLedger` rows for the korel half
- **Per-viewer state projection** — the server-side `tradeSessionView(session, viewerId)` projection existed but was never called; every emit sent the raw session shape `{tradeId, status, players: [...]}` to the whole room. Client reads `state.you.locked` / `state.them.locked`, both `undefined` on the raw shape, so `bothLocked` was always false and the Confirm button never appeared. New `broadcastTradeState(tradeId, session)` walks each socket in the room and emits a per-viewer projection. This was the actual bug behind "Lock In does nothing" — clicks were emitting and the server was processing, the response just wasn't readable
- **Post-trade recap** — when status flips to complete, panel titles switch to "You Gave" / "You Received," controls hide, and the offer rows persist as the summary. The "Trade complete!" banner gets a bigger gold-on-teal treatment so it reads as a result, not a passing toast
- **Confirm status text** — was silently showing "You are locked in. They are locked in." both before and after a Confirm click; the only visible change was the button disappearing, which made it look like nothing happened. Now also shows "You confirmed," "X confirmed," and "Waiting for X to confirm…" / "Confirm to complete."
- **Korel input UX** — switched from `<input type="number">` to `type="text" inputmode="numeric"` so cursor preservation and `setSelectionRange()` actually work (number inputs ignore both). Each keystroke also clamps the input value to your balance in-place
- **Item names display correctly** — uses `/api/inventory` instead of the id-only `/api/craft` map, so "Treated Sulwood" no longer shows as `treated_sulwood`. `/api/inventory` also now returns korel so the trade view has everything in one fetch
- **Cookie auth on trade sockets** — `resolveSocketAuth(socket)` reads the same `idya_session` cookie HTTP endpoints use; socket emits no longer carry an explicit token. Fixes a race between the SPA's URL-strip and the trade view's socket join
- **Join-status fix** — `??` vs `>=` precedence bug was flipping the trade to "active" on first join. Now correctly waits for both sockets in the room

### Inventory
- **Equip from inventory** — non-equipped weapon rows show an `Equip` button. `POST /api/character/equip` already existed; the UI just lost the wire-up during the SPA migration

### Shop / Economy
- **Weapon sells now update shop state** — the cart's weapon-sell loop was deleting `CharacterWeapon` rows and logging `ShopTransaction`s but never touching `ShopItemState`. Stock counters for weapon-keyed entries (Spellbook, Wand, Mental Cage, etc.) drifted from the daily-tick baseline regardless of real traffic. Now each weapon sell: checks current stock against `stock_max`, skips weapons that don't fit (instead of failing the whole cart), increments stock + cumulative_volume + recent_volume, and the cart response reports a `skippedWeapons` count
- **Shop liquidates at 75% full** — the daily tick was add-only, so items like venison sat at 200/200 forever and nobody could sell more. Now when stock is ≥ 75% of cap, the same rolled `Restock_Field` value is subtracted at 2× magnitude instead of added. Tunables: `DESTOCK_THRESHOLD`, `DESTOCK_MULTIPLIER` in `shop_service.ts`
- **Restock values scaled up ~3–4×** — everything was tuned for ~50-day full refills, which is too slow. Now targets ~14 days. Weapons + components (which players rarely sell back) feel the biggest benefit. See the audit table in PR for the full mapping

### Infrastructure
- **Version-stamped HTML asset URLs** — `/app/*` and `/battle/:id` now render their HTML with `?v=${pkg.version}` appended to every `.js`/`.css` URL and `Cache-Control: no-cache` on the HTML itself. Every deploy invalidates browser + Cloudflare caches automatically because the URL is literally different. (Shipped early as a 0.1.1 hotfix to unblock a user whose CF edge had cached a 404)
- **Cloudflare cache purge on prod deploy** — `deploy-prod.sh` now calls CF's `purge_cache` API after `pm2 restart`. Token + zone ID live in prod's `.env` (greps, not `source`, so `DATABASE_URL` doesn't re-leak). Belt-and-suspenders alongside the version-stamp

---

## 0.1.1 — 2026-06-01

Hunting moves into the web app, combat resolution gets a real per-phase
death check, and a swarm of small UX + naming polish across the battle
screen and shops.

### Hunt → Web App
- **Bait picker in the SPA** — `/hunt` now opens the hunt view inside the web app instead of running through Discord buttons; #forest channel gate preserved
- **Battle screen on the new palette** — colors brought into line with the rest of `/app`; status bar, action panel, log, and combatant cards all use the shared CSS variables
- **SPA layout header on battle page** — battle pages now show the same top header as the rest of the app, so navigation stays put when a fight starts
- **"Return to Town"** — post-battle button now lands you back on the hunt view inside the app
- **Profession train buttons moved** — out of the always-visible header and onto the Character page where they belong

### Combat Resolution
- **Sub-phase ordering: defend → attack → special** — actions now resolve in this fixed order within a round (this is what the tutorial has been teaching all along; previously they ran in submission order)
- **Player before AI within each sub-phase** — player defends, then AI defends, with a death check between each action. An AI's Defend action is no longer wasted on the trigger turn
- **Sequential DOT** — end-of-round damage-over-time ticks one combatant at a time (AI first), with a death check between every tick
- **First-to-zero loses** — if both sides hit 0 in the same step, the side that hit 0 first loses. No player-default tie-break
- **Battle ends on enemy KO** — a post-kill DOT can't cause a tie anymore; the round resolves as soon as one team is wiped

### Combat UI
- **Log line classification** — lines tagged as flavor / action-head / mechanics / move / status / crit and colored accordingly. Flavor text now reads as italic gold, mechanics as monospace muted
- **Log filter chips** — Flavor / Actions / Mechanics / Moves toggles in the log header, with localStorage persistence
- **Action category tags** — every action button now shows a `[defend]` / `[attack]` / `[special]` chip before the action name, so the rock-paper-scissors structure is visible at pick time
- **Status badges on combatant cards** — block, shield, DOT, buff, debuff, reflect each render as a small badge with remaining rounds
- **Own-tile target click fix** — clicking your own tile during target selection no longer bounces back to action select; self-targeting actions (Heal/Buff) can pick the player's tile

### Naming Consistency
- **Upgrade material names** — `/api/upgrade` now sends `material_name` alongside the id, so "Next: 3 Treated Sulwood" displays instead of `treated_sulwood`. "Need N material" error also uses the display name
- **Craft ingredient names** — hybrid weapon ingredients (sword_talamite, axe_talamite, etc.) resolve to the YAML Name instead of leaking the raw key
- **Shop toast bold** — buy/sell messages dropped the `**markdown bold**` since web toasts render asterisks literally

### Fixes
- **Weapon upgrades weren't applied in combat** — `createSession` rolled against the base weapon Field. Now applies the upgrade JSON (`base + player + enchants`) to the Weapon's actions before the session starts. Sebastian's Wand rolling 21 against a minimum 29 was the trigger
- **Upgrade endpoint wiped enchants** — the upgrade write was clobbering the `enchants` sub-key. Now spreads existing upgrades and only overwrites `base` / `player`
- **Shop stock display when full** — venison and other items couldn't be sold when shops hit max stock because the sell list hid quantity info. Stock now shows `XXX/YYY` and owned quantity stays visible even at cap
- **Crafting page locked recipes invisible** — `--text-vdim` on the dark background made locked recipe text unreadable. Switched to `--text-faint`

### Infrastructure
- **Deploy scripts `unset DATABASE_URL`** — the webhook process inherits `DATABASE_URL` from its environment, which was leaking into spawned deploy shells and causing prod deploys to connect to the dev database. Both `deploy.sh` and `deploy-prod.sh` now unset it so Prisma reads the repo's `.env`

---

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
