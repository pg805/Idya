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
