# Demo Wrap-Up — 2026-05-30

## Player Activity

Four people joined during the demo:

| Player | Joined | Current Korel | Equipped | Wins | Losses | Enemies Fought |
|---|---|---|---|---|---|---|
| Sebastian Sillybury | 16:34 | 60 | Deck of Cards | 38 | 0 | 5 |
| Spring | 17:42 | 0 | Branch | 0 | 0 | 0 |
| Decoats | 17:57 | 238 | Branch | 36 | 2 | 2 |
| Kalem | 18:07 | 39 | Spellbook | 22 | 1 | 2 |

**Total battles:** 99 (96 wins, 3 losses, ~97% win rate)

### Sebastian — power player
- Trained Enchanter all the way to **level 3** (cost: 100 + 300 + 700 = 1100 korel)
- Crafted **Spellbook** → swapped to **Deck of Cards** mid-demo
- Earned 1372, spent 1312 (1100 of that on training)
- Beat all 5 enemy types undefeated
- Inventory: 4 crystal_tooth, 6 thuvel, 4 deer_bait
- **The huge buys** (2M, 1B, 200M swallow_bait) revealed the unbounded API quantity bug — fixed mid-demo with a 9999 cap

### Decoats — economy focused
- Trained **Blacksmith level 1**
- Stayed on Branch the whole time, still 36-2 against Swallow and Sulfolk
- Only player to take healing fees (−4 korel)
- Currently sitting on the most korel (238)
- Inventory: 8 swallow_feather, 5 thuvel, 2 crude_talamite, 3 sulfolk_bait

### Kalem — quick converter
- Trained Enchanter level 1 → crafted **Spellbook** → equipped → went straight to fighting
- 22 wins, 1 loss to a deer at the end (no penalty, 0 korel at the time)
- Inventory: 41 swallow_bait, 3 thuvel

### Spring — character only
- Created character but never started a battle

## Economic Curve (Sebastian — peak engagement)

Over ~2.5 hours of play:
- 34 ledger transactions
- Peak balance: 323 korel (just before Enchanter L2 training)
- Lowest point: 7 korel after a deer_bait splurge
- Net trajectory: 0 → 60, with three training sinks (−100, −300, −700)
- Income mix: swallow_feather (frequent small), crude_talamite (consistent ~17/each), maek_egg (big hits at 60+ each)
- Healthy recovery curve after each training spend

## Feedback Notes (from demo, in raw order)

### Combat / UX
- Select action after moving in tutorial, or force pass
- Flavor text different color
- Filters on combat log: info vs flavor text
- Link back to Discord at end of battle/tutorial
- Bridge to the main game loop
- Get rid of battle link after battle is done
- DOT/Shield indicator
- Targeting your own square is a problem
- Turn order display
- Say attack/defend/special in combat UI
- Double click to pass, double click to do action, remove option to pass
- Hunt popup after hunting
- Level up doesn't update on the shop screen

### Shop / Crafting
- One ping per multiple transactions (shopping cart pattern)
- Shop sections, order by korel cost?
- ~~swallow bait~~ ✓ (made infinite during demo)
- Styling not applied on craft
- Running total of how much you are spending — shopping cart
- Buying linked to crafting and vice versa
- Identify items (ingredients, weapons, value, etc.)
- Sort weapon stats by profession
- More info on bait
- Drops command for enemies; bait links to loot table
- Level 2 crafting weapons

### Info / Discord
- Put commands in the channel topics, and descriptions
- Tabs on the website
- Webhooks if you leave a page open
- Clean up names to be consistent
- Level name overload (clarify what "level" means where)
- Bold korel, not star it in messages
- Put level up rewards/table somewhere

### Bugs / known issues
- Trading breaking
- Better error messaging
- Phone (mobile layout issues)

### Input
- Keyboard inputs rather than clicking

### Game systems
- AI for enemies needs to be done
