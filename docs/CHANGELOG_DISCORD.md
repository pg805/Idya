# Changelog (Discord)

Condensed, player-facing changelog posted to the #updates channel on each new release. For full detail see `docs/CHANGELOG.md`.

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
