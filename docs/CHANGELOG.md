# Changelog

The detailed, dev-side log. The condensed, player-facing version that goes
to the Discord #updates channel lives at `docs/CHANGELOG_DISCORD.md`.

## 0.1.6 — 2026-06-06

The "active battles, market page, economy plumbing" release. 0.2.0 is being
held for a full combat stats overhaul; everything that was queued for it
ships here instead.

### New enemy

- **Tinpul** (Lv 1, 10 HP). Squishy ranged shooter — pokes with Pea Shot
  (range 4, reactive) on the approach, then panics into melee Tin Punch
  when closed. Special is Harden Tin (shield 7 / 2 rounds + 4 block on
  Tin Drink). Crit applies Tin Coating, a Physical/Mental debuff for 4
  over 2 rounds. Drops sulwood, crude talamite, and rarely lifgem (~3%).
  Pulled by **Tin Bait** at the general store (3 korel).

### Recipe-driven shop pricing

- Crafted item prices now derive from their ingredient prices instead of
  reading a fixed YAML base. `final_price = Σ(ingredient_price × qty) × margin × R_mult`
  with `margin_buy` / `margin_sell` per recipe (default 1.1). Raw items
  keep `base × R_mult`. Fixes the thuvel-6 / hiruos-47 free-lunch where
  crafting and selling was a guaranteed profit regardless of materials
  market.
- Cross-shop ingredient lookups work transparently — kustaff at the
  enchanter pulls its quarterstaff price from the lumberjack on demand.
- Buying a crafted item now bumps ingredient `recent_volume` (full
  effect on buy, 0.5× on sell), so demand on hiruos pulls thuvel demand
  up too. The chain reaction propagates through the recipe DAG.
- `npm run price:smoke` walks every shop and dumps prices for sanity-
  checking after margin tuning.

### Market page (public, `/app/market`)

- New sidebar entry in the Info section showing every shop's current
  buy/sell prices plus a band the price can swing within.
- Cards per shop, ordered to match the sidebar (General Store →
  Blacksmith → Lumberjack → Enchanting Shop).
- Each card splits into **Commodities** and **Valuables** sub-tables —
  commodities sit near the floor under selling pressure, valuables float
  mid-range.
- Multi-select filter chips for Shop and Category at the top.
- Live-ticking countdown to the next daily price update per row.
- Crafted items inherit category from their ingredients: any valuable
  in the recipe chain promotes the output to valuable; otherwise
  commodity.
- Price ranges use **absolute multiplier bounds** (`base × [0.25, 4]`)
  so current price always sits inside. Equilibrium / period-2 math
  underestimated the floor under heavy selling pressure.

### Unlock items

- New item type: `unlock`. Permanent, character-bound, quantity always 1.
  Can't sell, can't trade, doesn't get consumed on use.
- **Swallow Bait** converted from consumable to unlock. Pick it up free
  from the General Store (future tutorial flow), keep it forever, use
  it to hunt swallows without consumption.
- Boot-time one-shot clamp lowers any pre-existing inventory rows of
  unlock items to quantity 1 — idempotent across restarts.
- Surfaces: market hides unlocks (no tradeable value), inventory tags
  them as 'permanent' in their own section, trade picker filters them
  out, shop sell flatly refuses, hunt-start skips the consumption step.

### Active battle tracking

- Hunt page now lists the player's in-flight battles with **Resume** +
  **Forfeit** buttons. Tutorial pinned to the top, then most-recent
  activity. Sessions are in-memory only (bot restart drops them — no
  phantom rows in `BattleLog` since rows only get written at `game_over`).
- Auto-forfeit after 7 days of inactivity. Sweep runs on every list
  fetch, so a stale session can't outlive the cutoff.
- Forfeit endpoint writes `outcome='forfeit'` per enemy (no korel
  penalty per design); bait is already consumed at hunt start so no
  refund either.
- `game_over` stamps `sessionMeta.endedAt`, so finished battles disappear
  from the active list immediately even though the 10-minute reward-UI
  cleanup timer is still ticking.
- `join_session` now replays every captured round to the rejoining
  socket (not just the initiative line), so the combat log fills in
  when a player resumes mid-battle.

### Tutorial resilience

- `/api/layout` returns a `tutorial_session_id` when the player has a
  character but `tutorial_complete=false`. If no active tutorial session
  exists in memory (closed tab, bot restart, 7-day timeout), the server
  spins up a fresh one. Client redirects on app init.
- `game.js` bounces to `/app/` on `"Session not found"`, so a dead
  `/battle/X` URL self-heals into a fresh tutorial via the layout flow.

### Dev stats page (`/app/dev/stats`)

- New dev-only page (sidebar entry gated by `is_dev` on `/api/layout`)
  showing aggregated battle data straight from `BattleLog`.
- Filters: Versions / Enemies / Weapons multi-select chips; First-mover
  tri-state radio (Either / Player / Enemy); pre-0.2.0 legacy bucket
  off by default.
- Group by Enemy or Weapon (pure presentation toggle — server returns
  both pivots of one matchup table).
- Metrics per row: Battles, Wins, Forfeits, Win %, Avg HP Left (wins
  only), Avg Enemy HP Left (losses only), DPR, DTR, Crits, Aim %,
  Restores, Duration. New schema columns on `BattleLog`:
  `player_hp_left`, `enemy_hp_left`, `damage_dealt`, `damage_received`,
  `rounds_count`, `crit_count`, `aimed_attempted`, `aimed_hit`,
  `restores`, `player_went_first`, `version`, `weapon_key`.
- Multi-enemy battles now emit one `BattleLog` row per enemy so the
  histograms count "absolute enemies fought" instead of "bait used."
  Player-side metrics (HP, rounds, crits, aim) duplicate across the
  rows; per-enemy metrics (damage dealt, HP left) split.
- Sim integration: `npm run sim:save` writes a canonical Monte-Carlo
  payload to `docs/sim/{version}.json`. Endpoint serves it on non-prod
  only; page renders a weapon × enemy win-rate grid when present.

### Combat instrumentation

- `CombatantState` gained `damage_taken`, `attack_crits`, `aimed_attempted`,
  `aimed_hit`, `restores` counters. `resolution.ts` increments them at
  the right hook points so the dev stats page has real signal to read.
- `CombatSession.deadCombatants` snapshots `{combatant, meta}` on each
  reap so `logBattlePerEnemy` (which runs at `game_over`, after every
  loser has been cleaned out) can still attribute per-enemy damage and
  HP-left.

### Doc + repo hygiene

- All markdown unified under `docs/` (was split across `database/docs/`
  and `database/lore/`). Player-facing docs are exclusively the three
  served by `/api/info/*`: `reference.md`, `about.md`,
  `lore/world_player.md`. Everything else under `docs/` is dev-only.
- `CLAUDE.md` action type table corrected (4=DOT, 5=Debuff — was
  swapped).

## 0.1.5 — 2026-06-05

The "fill in the docs and rebuild combat for teams" release. Three new info
pages (Lore, Reference, About), a full multi-combatant rewrite for combat
with DnD-style initiative, multi-enemy hunts on a much larger board, and a
big infrastructure pass to make the prod stack reliable.

### Combat — multi-combatant rewrite

The combat engine no longer assumes 1-vs-1. The architecture now generalizes
to N-vs-M with a single initiative system driving everything — a deliberate
stepping stone toward eventual PVP.

- **Initiative system** (DnD-style). Each combatant rolls `(1..100) − Weight`
  at battle start. Higher score acts first; ties resolved by "player beats
  NPC" then coin flip. Initiative ordering applies to action sub-phases
  (defend/attack/special), DOT ticks, and contested-tile movement priority
  — replaces the old hardcoded "player first" / "AI DOT first" / `isAI`
  movePriority rules. Initiative rolls log to the combat log on `join_session`
  (and persist as a synthetic "round 0" in the battle log).
- **Weight stat** on every weapon (YAML `Weight:` field) and on every enemy
  weapon. All weights currently `0` — per-weapon tuning is its own balance
  pass. Even at 0 weight the random roll spreads combatants across the
  initiative order.
- **Multi-enemy spawn**. 2.3% chance of a 2-enemy spawn on bait consumption.
  Two enemies get `A`/`B` name suffixes (e.g. `Melbear A`, `Melbear B`) for
  log disambiguation. Each spawn picks a random pattern start index so
  identical enemies don't telegraph identical actions on turn 1.
- **Dev `+2 (dev)` button** on each bait card (gated server-side by
  `isDev(discordId)`) forces a 2-spawn for testing without waiting on the
  2.3% roll.
- **Per-enemy loot** — each defeated enemy rolls its own loot table; results
  merge into one summary so the existing victory UI is unchanged.
- **Re-route algorithm changed** — when a combatant loses a contested move,
  it now re-routes toward its *original destination* (not the nearest enemy
  as before), which approximates "stop on the path you planned" when the
  blocking enemy is one tile ahead. Used `<=` for the tile comparator so the
  combatant will step toward the destination when chebyshev distance is tied
  (the "tile right before the blocker" case).
- **Conflict log reworded** — `X yields to Y.` → `X's path to (a,b) blocked
  by Y.`. The old "tie — neither moves" message is gone (unreachable now
  that initiative ranks are unique).

### Combat — board redesign

- **12×10 hunt board** (was 7×5). 120 tiles vs 35.
- **Random player spawn** in the top-left 5×5 box.
- **Distance-based enemy spawn**. Random chebyshev distance 6–8 at a random
  angle from the player. Two enemies maintain ≥ 3 chebyshev separation from
  each other.
- **Obstacle generation**: count sampled from a normal distribution (mean
  10, stddev 4, clamped 3–25). 3×3 buffer around every spawn tile so nothing
  is pinned in immediately. BFS verifies every enemy is reachable from the
  player; layouts that wall enemies off are re-rolled.
- **Tutorial board unchanged** — still the fixed 6×2 mini-layout.
- **Cell size tuned**: 72px → 48px desktop, 44px → 28px mobile. The 12-wide
  board is now 576px on desktop, 336px on mobile (fits a typical phone).

### Info pages

Three new pages under the **Info** sidebar group, all rendered from markdown
under `database/lore/` and `database/docs/`:

- **Lore** (`/app/lore`) — curated player-facing world doc: world background,
  the Chaevul Empire, Sidaev, the gods, Sulku'it, and town-introduction style
  NPC blurbs. Sidebar of sections, detail panel on the right. Designer-facing
  `world.md` is kept separate so personal NPC notes / spoilers don't leak.
- **Reference** (`/app/reference`) — game terms reference: Currency & Stats,
  Combat Actions, Damage & Resistances, The Battle, Hunting, Town Shops, The
  Bench, Professions, Trading, Weapons, Items, and a Glossary that links
  back to every section. Includes nested-list + table + intra-page anchor
  link support in the markdown renderer.
- **About** (`/app/about`) — single-section narrative page from the dev about
  the game's origin and design intent.

The renderer used by Lore/Reference picked up support for tables, nested
bullet lists, numbered lists, `code` spans, and intra-page anchor links
(`[Term](#section-slug)` jumps to the linked section via the SPA's section
selector instead of doing a full navigation).

### Crafting / recipes

- **Spellbook tier-2 and tier-3 recipes added**. Spellbook was the only L1
  weapon missing higher-tier variants:
  - `Spellbook (Hiruos)` at Enchanter level 2 → spellbook with +1 attack
    baked in (mirrors Quarterstaff (Treated) and Dagger (Talamite))
  - `Spellbook (Nodol)` at Enchanter level 7 → spellbook with +1 def/+1 atk/
    +1 spec baked in (mirrors Kustaff (Nodol) and Mental Cage (Nodol))

### Shop economy

- **Hourly destock loop**. `TICK_INTERVAL_MS` (24h) blocked the destock from
  firing more than once per day per item, so popular shelves (venison,
  thuvel, hiruos, maek_egg pinned at cap on prod) waited hours-to-a-day for
  any flush. Split into two clocks: daily tick still owns price update +
  low-stock restock; new `maybeHourlyDestock` runs on the same hourly walk
  and dumps `6 × rolled Restock_Field` whenever stock ≥ 75% of cap. In-memory
  `lastDestockAt` map gates one destock per item per hour (lost on restart —
  acceptable, restart just triggers a fresh round of catch-up flushes).
- **Stock_Max bumps on hot items**:
  - venison 200 → 800, maek_egg 50 → 200 (general store)
  - thuvel 500 → 2000, hiruos 200 → 800 (enchanter)
  - swallow_feather 1000 → 2000 (general store)
  - crude_talamite 500 → 2000 (blacksmith), sulwood 500 → 2000 (lumberjack)
  - melstone 300 → 1000 (blacksmith)
  - felt_hat 500 → 1000, bottle_of_tar 300 → 1000 (lumberjack)
- **SHOP_DIR TDZ fix** — `runShopTick()` was being invoked synchronously at
  module load before `SHOP_DIR` was declared, so the hourly shop tick had
  been silently failing on prod every hour since 0.1.3 with
  `ReferenceError: Cannot access 'SHOP_DIR' before initialization`. Deferred
  to `setImmediate(...)` so SHOP_DIR is bound before the first tick. Means
  the new hourly destock loop will *actually run* on prod.
- **Volume columns → BigInt**. `cumulative_volume` + `recent_volume` on
  `ShopItemState` were INT4 (ceiling 2.1B). The infinite `swallow_bait`
  tutorial item drove `cumulative_volume` past INT4 in testing and broke
  buy/sell on prod with a "Unable to fit integer value '2147483648' into
  an INT4" Prisma error. Widened to BigInt; math sites coerce to Number
  (values stay far below MAX_SAFE_INTEGER).

### Diagnostics

- **Express request logging** — middleware emits one line per dynamic
  request: `[req] 2026-06-05T01:32:43.277Z 1.2.3.4 GET /url 200 13ms`. Static
  asset hits are skipped unless they 4xx/5xx. CF-Connecting-IP preferred over
  socket peer so the IP is the real client.
- **Client error capture** — new `POST /api/client_error` endpoint plus
  `public/error-capture.js` wires `window.error` + `unhandledrejection` to
  POST `{url, message, source, line, col, stack, ua}`. Throttled to one
  POST per message per minute. Uses `sendBeacon` when available so capture
  survives page unload. Loaded by both `app.html` and `index.html`. Lets us
  remotely diagnose white screens / SPA crashes without devtools on the
  user's end.
- **Webhook script gets request logging**. `webhook/index.js` now logs
  every incoming GitHub delivery with method, URL, IP, UA, delivery ID, and
  the routing decision (`-> 200 (deploy dev)`, `-> 401 (bad signature)`,
  `-> 404 (method/url mismatch)`, etc.). Cross-references with the
  cloudflared journal made the "intermittent webhook 404s" debug session
  tractable.
- **Discord interaction listener consolidation**. 12 separate
  `client.on(InteractionCreate, ...)` registrations consolidated into one
  dispatcher backed by an `interactionHandlers[]` array. Each handler still
  owns its own filter (`isChatInputCommand && commandName === 'X'`) and
  early-returns when not addressed. Error in one handler doesn't break the
  siblings (each call wrapped in try/catch). Killed the
  `MaxListenersExceededWarning` that fired on every restart.

### Infrastructure

- **Cloudflared tunnel consolidation**. Discovered a second `cloudflared`
  instance on the `proxy` VM running an older config with non-overlapping
  hostname rules (handled `webhook.slowb.rodeo` + `foundry.slowb.rodeo`,
  but no `idya.slowb.rodeo` route). Cloudflare load-balanced incoming
  requests across both replicas, which meant about half of all hits to
  `idya.slowb.rodeo` 404'd at the catch-all on the proxy replica, and
  half of all hits to `webhook.slowb.rodeo` 404'd on the db-server
  replica. Classic intermittent-404 pattern across all 0.1.x. Fix:
  consolidated all hostnames into the db-server `cloudflared` config
  (`idya`, `webhook`, `foundry` all point at `localhost:9000/3001` or
  `10.0.0.3:30000`), stopped + disabled cloudflared on the proxy box.
- **Cloudflared 2026.5.2 upgrade** on db-server with `edge-ip-version: "4"`
  pinned in config — the 2026.5.2 default of `auto` prefers IPv6, which is
  asymmetrically broken on the prod ISP and caused a brief total outage
  during the upgrade until pinned to v4.

---

## 0.1.4 — 2026-06-03

Mobile-friendly UI, keyboard combat controls, the Golnosar joins the
roster, a few item renames, and economy tuning so prices actually
react to player trading.

### Mobile
- **Responsive top-level layout** — collapsing sidebar becomes a hamburger drawer below 720px, header reflows, content columns stack vertically. Tested down to a 390px viewport.
- **Battle board scales** — cell size now drives off a `--cell-size` CSS variable. On mobile, layout stacks vertically (board above controls) and cells shrink to 44px so a 7-wide board fits in 308px instead of overflowing 504px. Touch-friendly action buttons sized at 44px+ minimum.

### UI Polish
- **ALL buttons restored** — sell-stack and craft-max buttons in the shop and crafting panels. One click to dump the full stack or craft the most a budget allows.
- **Battle keyboard input** — arrow keys move (or click-target), `1`–`9` selects action by index, `Enter` confirms / skips / returns to town. Hunt page also accepts `Enter` to confirm bait selection.

### New Content
- **New enemy: Golnosar** (Level 4, 110 HP). Pool-dwelling living-tar creature. Resource: Tar (max 10). Tar Drink (defend, blocks 10 + restores 10 Tar), Tar Shot (attack, reactive, range 1, swingy 0–8 blunt), Blind crit (DOT, 10 per round for 3 rounds), Fistar (special, aimed, range 4, arcane fire DOT 5–14 for 5 rounds). 8-step pattern (drink → 4× shot → fistar → 2× shot). Sim shows ~40% win rate on Talamite Axe/Shovel with 50% aim-miss assumption. (Post-release tweak: Tar Shot range dropped 3 → 1 — was too punishing as a reactive ranged attack; melee-only forces the golnosar to close before it can spit.)
- **Tar Bait** at the general store (60 buy / 18 sell). Summons Golnosar.
- **Bottle of Tar** drops to the lumberjack (90/30, used for waterproofing).
- **Lifgem** drops as a rare valuable (1-in-20 from Golnosar). Goes to the enchanter (800/400). Priced for "will become more common when other enemies drop it" — moderate stock cap, modest unit value.
- **Card Deck** new general-store material (10/3). Recipe ingredient for both Deck of Cards weapon and its Nodol upgrade. Flavor: "A simple deck of cards with the Chae emperor, Gustavus, as the king."
- **Lore: Emperor Gustavus** — the previously unnamed Chae emperor now has a name. His face is stamped on every korel coin (the most common way subjects see him), and on the king card in standard playing decks. Added to `database/lore/world.md`.

### Renames
- **`bear_teeth` → `melstone`** — flavor reframe ("a dense stone passed through a melbear's gut, worn smooth — used as a heat-resistant core"). Updated in items.ts, melbear.yaml drop, blacksmith.yaml shop listing.
- **`diamond` → `lifgem`** — diamond was placeholder; lifgem fits the world (faintly pulsing gemstone the enchanter pays for). Repriced for projected future drops from other enemies.
- **Production migration required on release**:
  ```sql
  UPDATE "ShopItemState"   SET item_id='melstone' WHERE item_id='bear_teeth';
  UPDATE "ShopTransaction" SET item_id='melstone' WHERE item_id='bear_teeth';
  UPDATE "InventoryItem"   SET item_id='melstone' WHERE item_id='bear_teeth';
  UPDATE "ShopItemState"   SET item_id='lifgem'   WHERE item_id='diamond';
  UPDATE "ShopTransaction" SET item_id='lifgem'   WHERE item_id='diamond';
  UPDATE "InventoryItem"   SET item_id='lifgem'   WHERE item_id='diamond';
  ```

### Economy
- **R / R_Max tier split** — three pricing personalities now baked in:
  - **Bulk** (raw + intermediate + tier-3 materials, components, weapons): `R: 2.0`, `R_Max: 3.4`. Period-doubling band. Mostly predictable, mild oscillation under heavy trading. Grinder-friendly.
  - **Valuables** (loot drops — swallow_feather, venison, maek_egg, crystal_tooth, felt_hat, antler_trophy, melstone, bear_paw, bottle_of_tar, lifgem): `R: 3.0`, `R_Max: 3.99`. Full chaos band. Prices swing tick-to-tick under any sustained traffic. Sellers should time the market.
  - **Baits**: `R: 1.0`, `R_Max: 2.5`. Idle decay toward floor, demand pushes back up to ~1.5× baseline. No chaos (stable convergence band).
- **Volume_Sensitivity slashed** — old values needed unreachable volume (thuvel needed ~56,000 cumulative units to push r meaningfully). Cut roughly 5–8× across the board:
  - Bulk raw 400 → 50, intermediates 100 → 20, tier-3 mats 50 → 10
  - Components tier-2 40 → 8, tier-3 20 → 5, weapons 15 → 4
  - Valuables: swallow_feather 750 → 100, crystal_tooth/felt_hat 400 → 80, melstone 200 → 30, venison 150 → 30, maek_egg 40 → 10, antler_trophy/bear_paw 8 → 3
  - Baits 0 → 30 (was special-cased to skip the formula entirely)
- **Bait demand is responsive** — `Volume_Sensitivity` was 0 (locked at R=1.0 regardless of volume), now 30. Combined with R_Max 2.5, hammered baits walk price up to ~1.5× baseline; idle baits decay back toward the floor.

### Tooling
- **Simulator: aimed-attack hit roll** — `src/tools/simulate.ts` now rolls 50% hit/miss on any `aimed: true` action (both sides). Without this, sim treated every aimed shot as a hit, which inflated DOT-heavy specials like Fistar and Ursa Major. Real combat is spatial and targets can dodge by moving off the tile. Sim-only; combat engine unchanged.

### Infrastructure
- **Discord changelog split** — `docs/CHANGELOG.md` stays detailed for dev/devops; new `docs/CHANGELOG_DISCORD.md` is condensed and player-safe. The version auto-announcer (`extractChangelogSection`) now reads from the Discord file so spoiler-heavy enemy specs and code-level detail don't leak into the public channel.

---

## 0.1.3 — 2026-06-02

Character creation and the tutorial-day hand-off move into the web app,
a new endgame enemy (Melbear) joins the forest, hunt boards randomize,
the shop tick runs proactively on a server timer, and the trade view
picks up a handful of polish items.

### Character Creation in the SPA
- **`/app/create` view** — full character form in the web app: name + bio + nationality buttons + scrollable sprite grid with live filter. Drops you straight into the tutorial battle on submit.
- **Discord welcome embed unchanged** — same Fendalok dialogue + "Register in the Census Log" button. Button (and `/createcharacter`) now reply with an ephemeral deep-link to `/app/create?auth=…` instead of opening a Discord modal chain. `/createcharacter` reply also shows the full welcome embed so the world hook lands either way.
- **POST `/api/character/create`** + helper `bootstrapNewCharacter()` that creates the character row + the tutorial battle session in one server call.
- **GET `/api/sprites`** returns the full sprite list for the picker.
- Sprite list trimmed: Neon, Rend, Borealis, Toby Teist, DeCoDra removed (PNGs stay on disk so existing equipped sprites still render).
- Lone Climber and Francesco sprites flood-filled to transparent backgrounds.
- Dev now overrides `sprite_cdn` to its own branch on GitHub so sprite asset changes show up on dev before main.
- Old `CreateCharModal` / `NationalitySelect` / `PickSprite_` Discord handlers and the `pendingCharCreation` in-memory map deleted.

### Tutorial Hand-off
- **"Go to Town"** — post-battle button on the tutorial run lands you on `/app/character?tour=1` (mirrors the post-hunt "Return to Town" pattern).
- **Sidebar walkthrough** — 7-step gold-bordered tour highlighting Town Shops → Hunting → Korel header → Professions header cards → Character & Activities → The Bench → Reference. Copy walks the gameplay loop. Triggered only by `?tour=1` so the create page doesn't get caught in the auto-fire.

### Combat / Hunt
- **Random hunt boards** — non-tutorial battles roll 2–6 obstacles uniformly in the (1,0)–(5,4) rectangle each session. BFS re-rolls layouts that would wall the player off from the enemy. Tutorial board unchanged.
- **New enemy: Melbear** (Level 5, 300 HP). Resource: Solitude (max 8). Hibernate (defend, restores 6 solitude), Berry Snack (defend, heals 30), Ursa Minor (attack, range 1, swingy 0–20), Gash crit (DOT, 4–8 for 3 rounds), Ursa Major (special, range 2, arcane mental, peaks at 36). 7-step pattern alternates the heal in mid-cycle. Designed for players running upgraded L4 talamite weapons; sim shows ~40% win rate on stock Talamite Shovel.
- **Bear Bait** in the general store (100 korel — pricey vs the other baits).
- **Bear Teeth** drops to the blacksmith (new valuable in that shop, 120 buy / 40 sell).
- **Bear Paw** drops to the lumberjack (1200 buy / 600 sell, alongside antler trophy).

### Shop Economy
- **Proactive shop tick** — `maybeTickDaily` was page-load triggered; if nobody visited a shop for 3 days, no ticks. Now a server `setInterval` runs `tickAllDue(SHOP_DIR)` once at startup + every hour. Per-item 24h gate unchanged.
- **Destock multiplier bumped 2× → 6×** — when a shop hits 75% of cap, it now dumps `6× rolled Restock_Field` value per tick. Keeps shelves clearing so players can always sell loot.

### Trade Polish
- **Server-side name enrichment** — `tradeSessionView` now projects items through `projectOffer` which attaches the display name from the `ITEMS` map; "swallow_feather" no longer shows as a raw id when the receiver doesn't have that item in their own inventory. Weapons offered as `{id, name, bonus}` objects (client supplies the name).
- **Typeable item quantity** — items in your offer panel get a number input alongside the +/− buttons. Same in-place clamp and focus preservation as the korel input.
- **Header korel refreshes after trade complete** — trade view calls `mountLayout()` on `trade_complete`. Other korel-touching views already did this; trade was the gap.
- **Korel input UX** — switched to `type="text" inputmode="numeric"` so cursor preservation actually works (number inputs ignore `setSelectionRange`). Real-time clamping.
- **Trade summary stays after the swap** — panel titles flip to "You Gave" / "You Received" and the offers stay visible as a recap instead of a fleeting toast.
- **Confirm status text** added: "You confirmed", "X confirmed", "Waiting for X to confirm…".
- **Korel + Weapons in offers** — earlier in 0.1.3 dev, weapons and korel became tradeable alongside items. Atomic transfer in one Prisma transaction, KorelLedger rows for the korel half, equipped weapons refused.

### Fixes
- **Shop transaction left the cart broken** — `clearCart` was missing the `buyWeapons: {}` initializer, so after a checkout `cart.buyWeapons` became undefined and the next render threw, silently aborting the `await mountLayout()` that follows. Net effect: header korel didn't update + the shop UI deadlocked until refresh. One-line fix.
- **Near-invisible grey on dark background** — sweep replaced `--text-vdim` with `--text-faint` on `.shop-item-name.dim`, `.shop-empty`, `.empty`, `.cannot-upg`, `.prof-none`. Item names on full-shop sell rows are legible again.
- **Diagonal corner-cutting through obstacles** — combatants (and aimed attacks) could squeeze between two diagonally-touching obstacles. Now blocks the diagonal step when both orthogonal neighbors are obstacles. Applied to server movement BFS, server LOS, the matching client copies, and the hunt-obstacle reachability re-roll check.

---

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
