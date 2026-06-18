# Changelog (Discord)

Condensed, player-facing changelog posted to the #updates channel on each new release. For full detail see `docs/CHANGELOG.md`.

## 0.2.1 — 2026-06-18

Bigger beasts, a brand-new tutorial, and a pile of fixes.

- **Bigger enemies.** The Melbear and Sulgovenath now take up a 2×2 space on the board. They're harder to kite, and the Melbear's ground-pound hits the whole ring around it.
- **New player tutorial.** A guided walkthrough of the battle screen, the story of how you arrived in Sulku'it, and step-by-step combat coaching — replay the guide or the lore anytime from the battle screen.
- **Standardized number inputs.** Crafting, the shops, and Town Square all use the same −/type/＋/ALL controls now.
- **Profession roles in Discord.** Earn a badge the first time you rank up each profession, **Journeyman** at total rank 5, and **Master** at rank 10. New members also get a role when they join.
- **Town Square contributions** now post to the channel as they happen, so everyone can watch a quest fill up.
- **Quick or Confirm actions.** Choose **Quick** (one click fires your action) or **Confirm** (review, then commit), with a Back button — set it in the settings menu.
- **Professions page** now shows the **max level** each weapon can reach (3 upgrades = a level).
- **Market** page shows the correct countdown to the next price update.
- Crit fixes: a crit only fires when your action actually connects with the enemy in the matchup, and a few cases that were wrongly skipped now land. Aimed targeting also matches movement on diagonals.
- Cleaner display for weapons with very long stat lists — no more blown-out panels.

---

## 0.2.0 — 2026-06-13

The big combat & crafting overhaul.

- **Smarter enemies.** Enemies now read the fight and decide for themselves instead of running a fixed script — closing in, backing off, bracing, healing, and picking targets based on what's happening on the board.
- **Livelier markets.** Prices recover and move more naturally now. Check the Market page before you sell.
- **Combat log, rebuilt.** Every action now reads as a clean block — a line of flavor, the action and its result, and (if you want it) the full breakdown of the math behind it. One **detail dial** — Minimal / Standard / Story — sets how much you see.
- **Battle screen redesign.** Steadier layout that doesn't jump around, actions grouped by category with their crits, and your stats clearer at a glance.
- **All Defend and Special actions have crits now**, not just Attack — each fires when your action beats the enemy's in the category matchup. Read your opponent.
- **Upgrading, reworked.** Upgrades now give you a pool of points to spend across a weapon's actions, and each upgrade adds HP automatically. You upgrade your own profession's weapons.
- **Enchanting, reworked.** Four enchant kinds — add HP, add a melee strike, add a ranged attack, or pour extra power into an action you already have. Three slots, applied by the Enchanter once your rank is high enough for that weapon.
- **Three new top-tier weapons** to craft, each one needing parts from all three professions to assemble.
- **Two new endgame foes** stalk the deep forest.
- **Town Square quests** — timed community deposit goals, with rank trophies for the biggest contributors.
- The in-game **Reference** page is fully up to date with all the new systems.

> Heads up: a few weapons and the old-style enchants from before this update are retired. Any you're holding get cleared and **refunded automatically** the first time the update runs.

---

## 0.1.6 — 2026-06-06

- New enemy: **Tinpul** (Lv 1). Squishy little tin shooter — pokes from range, panics into melee, shields up when cornered. Pulled by Tin Bait at the general store.
- New page in the Info sidebar: **Market**. See current buy/sell prices for every shop and the band each item can swing within. Live countdown to the next daily price update.
- Hunt page now shows your **active battles** with Resume + Forfeit buttons. Forfeiting costs the bait but nothing else.
- Battles auto-forfeit after a week of inactivity, so old sessions don't pile up.
- Tutorial no longer strands you if you close the tab — the next time you open Idya it picks a fresh tutorial up for you.
- Crafted items at the shops now follow their ingredient prices. Cheaper materials → cheaper crafted goods; demand on a finished item pulls demand on its inputs.
- **Swallow Bait** is now a permanent permit instead of a single-use item. Pick one up free from Dolan, keep it forever, hunt swallows whenever. Existing piles will collapse down to a single permit on the next bot restart.
- **Enemy trophies**: defeat any enemy for the first time and you'll keep a permanent trophy that tracks how many times you've defeated it. Past wins count — your existing defeats get credited automatically. Trophies upgrade in tiers as your defeat count grows: **Bronze** at 100, **Silver** at 300, **Gold** at 1000.
- New **Stats** page in the sidebar shows all your trophies and permanent unlocks in one place.

## 0.1.5 — 2026-06-05

- New info pages: **Lore**, **Reference**, and **About** in the sidebar.
- Hunts now happen on a bigger board (12×10) with random player + enemy spawns and randomly placed obstacles.
- Small chance (2.3%) a bait pulls a second enemy with it. Both drop loot.
- Combat turn order is now decided by an **initiative** roll at the start of each battle — higher roll acts first, even between enemies.
- **Spellbook** now has Tier-2 (Hiruos) and Tier-3 (Nodol) recipes like the other starting weapons.
- Shop shelves now flush popular items every hour, so the world keeps moving when items pile up.
- Stock caps raised on the most-traded items so shops don't choke as more players hunt.
- Webhook + tunnel reliability fixes — the intermittent 404s and missed deploys across 0.1.x should be largely gone.

---

## 0.1.4 — 2026-06-03

- Something new is stirring in the tar pools. Bring a bait that matches.
- New item: Card Deck (general store), used to craft the Deck of Cards weapon.
- Idya plays on your phone now. Sidebar tucks into a menu, battle board fits the screen.
- Combat keyboard controls: arrow keys to move, number keys to pick actions, Enter to confirm.
- "ALL" buttons in the shop and crafting panels — one click to dump a stack or craft the max you can afford.
- Rename: Bear Teeth → Melstone (your stacks will carry over).
- Shop prices now respond to player trading — busy markets get volatile, quiet markets stay predictable.
- Loot drop prices are in full chaos mode. Check the market before selling rare items.
- Bait prices respond to demand too, so popular hunts get pricier over time.

---

## 0.1.3 — 2026-06-02

- A new beast stalks the forest. Bring something heavy.
- Each hunt's terrain rearranges itself between sessions.
- Character creation has moved into the web app, with a guided tour for new arrivals.
- Weapons and korel can now ride along in trades.
- A handful of shop and combat fixes.
