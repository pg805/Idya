# Currency and Stats

**Korel** is the standard currency. Earned by selling loot to shops. Used to buy weapons, baits, and materials.

**Health (HP)** is your survival pool in a fight. Drops to zero, you lose the battle.

**Resource** is a per-weapon secondary stat. Each weapon names its own — Stamina, Flow, Noko, Luck, and so on — and most attacks cost some to use. Most weapons have a dedicated action to restore it.

---

# Combat Actions

Every weapon has **six action sets**: a **Defend**, an **Attack**, and a **Special** you choose from, plus a **crit** paired with each of those three categories.

You pick one Defend, Attack, or Special each turn. The matching **crit** is a bonus action that fires automatically when you win the category triangle (see Crits, below).

Actions come in several types. Some take effect immediately, others apply a duration over several rounds. **Duration effects never stack** — applying a new one replaces the existing one on the same target.

| Type | Effect | Duration |
|---|---|---|
| **Strike** | Direct damage | Immediate |
| **Block** | Subtracts a flat amount from damage you take this round | Immediate |
| **Buff** | Adds a flat amount to your damage rolls | Duration |
| **Debuff** | Subtracts a flat amount from the target's damage rolls | Duration |
| **Heal** | Restores HP | Immediate |
| **DOT** (Damage Over Time) | Damage that ticks each round | Duration |
| **Reflect** | Sends a flat amount back any round you take a Strike | Duration |
| **Shield** | Subtracts a flat amount from damage you take each round | Duration |

**Positional actions.** Some weapons act on the board instead of hitting a target directly:

- **Tiles** — drop a zone on the grid. **Block** and **Buff** tiles aid whoever stands on them; **Hazard** tiles hurt enemies that step onto them; **Slow** tiles cost extra movement to leave.
- **Slow** (movement debuff) — caps a target's movement for a few rounds.
- **Destroy Obstacle** — shatters an obstacle and sprays the area around it.

**Field** is the roll table for any value that varies — usually the damage on a Strike or DOT tick. `Field: [0, 1, 2, 5, 6, 7, 8]` means each use picks one of those values at random.

**Range** is how far the action can reach, measured in tiles (diagonals count as one step).

**Aimed vs Reactive**:
- **Aimed** — you pick a target tile before the attack fires. Less reliable, requires prediction.
- **Reactive** — fires automatically at the nearest valid target in range. More reliable.
- **Self-targeting** — Heal and Buff actions target the user automatically; no tile selection.

**Crits — the category triangle.** The three categories beat each other in a ring: **Defend ▶ Attack ▶ Special ▶ Defend**. Each turn, if your action's category beats an opposing combatant's, your matching crit fires at them as a free bonus action:

- Your **Attack** beats their **Special** → your **Attack Crit** fires.
- Your **Special** beats their **Defend** → your **Special Crit** fires.
- Your **Defend** beats their **Attack** → your **Defend Crit** fires (a counter to the attacker).

A crit can be any action type — a damage counter, extra block, a debuff. It resolves alongside the action that triggered it and only reaches targets within range.

**Damage calculation.** When a Strike lands, the rolled damage is adjusted by the attacker's active Buff (added) and Debuff (subtracted), then reduced by the target's Block and Shield. Final damage cannot go below 0.

- **Buff and Debuff are mutually exclusive on the same target.** Applying one clears the other.
- **Block resets at end of round.** It must be re-applied each round. Two blocks the same round add together.
- **Shield is not a depleting pool.** Its value subtracts from incoming damage each round for the duration.
- **Reflect fires on any incoming Strike** regardless of damage landed, and sends a flat amount back.

---

# Damage and Resistances

Every action carries a **Damage Type** and a **Damage Subtype**. The two are independent — any type/subtype combination is possible (an action can be Arcane Sharp or Elemental Blunt, and enchants can remix them).

**Damage Types:** **Physical**, **Arcane**, **Elemental**.

**Damage Subtypes** are more specific flavors — Sharp, Blunt, Mental, Force, Poison, Fire, Water, Earth, Wind, Plant, Light, and more. An action's exact type and subtype are listed on the [Weapon Stats](/app/weapon-stats) page.

Enemies have **Resistances** against each type and subtype. Your action's type and subtype are evaluated against the enemy's, and the combined result maps to a roll mode:

| Matchup | Roll mode | Behavior |
|---|---|---|
| **Weakness** | **Hd4** | Roll 4 dice, take the highest. Big variance, skews high. |
| **Resist** | **Ld2** | Roll 2 dice, take the lowest. Skews low. |
| **Neutral** | **1d** | Single roll. Baseline. |

When a roll is skewed, the combat log's resolve view labels it **Weakness (take highest)** or **Resist (take lowest)** and shows every die rolled. Type matchups shift the roll distribution; they don't apply a flat damage multiplier — a weakness makes a big hit *likely*, not guaranteed.

---

# The Battle

Battles are turn-based on a grid against one or more enemies from the [Enemies](/app/enemies) roster. Every combatant begins at **full HP and full Resource**.

At the start of every battle, every combatant rolls for **initiative** — a random score that decides turn order for the whole fight. Lighter weapons (lower **Weight**) roll higher on average and act earlier. The roster appears at the top of the combat log under a **▸ Initiative** header, in the order combatants will act. On a tie, the player wins against an NPC; otherwise it's a coin flip.

Each turn unfolds in three phases:

1. **Intent phase** — every combatant picks a move target and an action for the turn.
2. **Move phase** — every combatant executes their movement step in initiative order. If two want the same tile, the higher-initiative one takes it; the other re-routes toward its original destination, or stays put if it can't get any closer.
3. **Action phase** — actions resolve in a fixed order, with each crit firing alongside the action that triggers it:
   - **Defend actions**
   - **Attack actions**
   - **Special actions**
   - **DOT ticks** (end of round)

Within each sub-phase, combatants act in initiative order. The battle ends the moment any team has no combatants left with HP above 0 — that team loses.

Range, line of sight, and **obstacles** all affect movement and targeting. Obstacles are rolled randomly per hunt and block both movement and aimed attacks. Diagonal moves cannot pass between two obstacles that touch corners.

---

# Hunting

Hunts happen on the **Hunt** page. Each hunt costs one bait from the General Store, and each bait summons one specific enemy:

| Bait | Enemy |
|---|---|
| Swallow Bait | Lithkem Swallow |
| Tin Bait | Tinpul |
| Sulfolk Bait | Sulfolk |
| Wyrm Bait | Talwyrm |
| Deer Bait | Daefen Deer |
| Toad Bait | Maetoad |
| Tar Bait | Golnosar |
| Bear Bait | Melbear |
| Sidaev Bait | Child of Sidaev |
| Sulgovenath Bait | Sulgovenath |

The later enemies are **endgame** — built for players with upgraded, enchanted weapons. A base weapon is meant to lose to them.

**Loot** is rolled at the end of a victorious battle. Each enemy has a drop table — see the [Enemies](/app/enemies) info page for exact roll tables.

Each hunt rolls a fresh board layout with obstacles placed randomly in the open zone.

**A bait occasionally pulls a second enemy of the same type** — a small chance per hunt. Both must be defeated, each drops loot, and the combat log distinguishes them with an `A` / `B` suffix. Their action patterns start offset so they don't move in sync.

---

# Town Shops

Sulku'it has four shops. Each one buys back items at a sell price and stocks goods at a buy price.

- [**General Store**](/app/shop/general_store) (Dolan) — baits, miscellaneous valuables.
- [**Blacksmith**](/app/shop/blacksmith) (Kethalis) — talamite materials, metal weapons, blacksmith components.
- [**Lumberjack**](/app/shop/lumberjack) (Vetha) — sulwood materials, wood weapons, lumber components.
- [**Enchanting Shop**](/app/shop/enchanting_shop) (Lomis) — enchanting reagents, arcane weapons, valuable gemstones.

Prices move with the market. Shops respond to player trading: heavy buying pushes prices up, heavy selling pushes them down. Some items (valuables) swing harder; bulk materials shift more slowly. Idle items drift back toward their baseline. You can see every shop's current prices and swing bands on the [Market](/app/market) page.

If a shop's shelf is full of an item, it stops buying that item until stock clears. Shops dump excess stock on their own schedule.

---

# The Bench

The **Bench** is where materials become items, weapons, and enchants. It splits into three pages, one per profession:

- [**Crafting**](/app/crafting) — combine materials and components into finished weapons, intermediates, and reagents. Higher-tier recipes bake bonuses into the crafted weapon (see [Items](#items)).
- [**Upgrading**](/app/upgrade) — spend your profession's tier-2 or tier-3 material to permanently boost a weapon you own. You can only upgrade weapons of **your own profession**. Each upgrade adds some HP automatically and gives you points to distribute across the weapon's actions. How many upgrades a weapon can take is gated by your profession **rank** and the weapon's level.
- [**Enchanting**](/app/enchant) — the Enchanter applies enchants to a weapon's three permanent slots, one enchant per slot. There are four kinds:
  - **Health** — adds flat HP.
  - **Melee** — adds a short-range Sidaev Strike attack to the weapon.
  - **Ranged** — adds a longer-range Sidaev Pulse attack.
  - **Upgrade** — pours extra power into one of the weapon's existing actions, and can change its damage type/subtype.

  Enchant strength scales with the weapon's level. You can enchant **any** weapon — regardless of which profession crafted it — once your Enchanter rank is high enough for that weapon's level.

---

# Professions

There are three professions: **Lumberjack (LJ)**, **Blacksmith (BS)**, and **Enchanter (EN)**. You can level each one from 1 to 10, with a combined cap of 30 across all three.

The cost of a level depends on your **total** profession levels across all three. Your 1st level (in any profession) is cheap; your 30th — the last one to reach the cap — is expensive. The profession you put it into doesn't change the price.

Picking up a second or third profession late costs more total korel and materials than specializing. Players are expected to trade to cover gaps in their own professions.

You raise profession levels on your [Character](/app/character) page.

**Each weapon belongs to exactly one profession**, and you can only craft and upgrade your own profession's weapons:

| Profession | Crafts & upgrades |
|---|---|
| **Lumberjack** | Axe, Sword, Shovel, Kustaff, Crossbow |
| **Blacksmith** | Pickaxe, Dagger, Mace, Battle Axe, Nunchaku |
| **Enchanter** | Deck of Cards, Spellbook, Mental Cage, Wand, Scythe |

Some higher-tier weapons need a **component crafted by another profession** to assemble — so you'll either pick up a second profession or trade for the part — but the finished weapon still upgrades under its own profession.

**Enchanting is separate from professions.** It's an Enchanter ability that works on any weapon, gated by the weapon's level against your Enchanter rank (apply it on the Enchanting page above), not by which profession made the weapon.

Each profession level grants either a new recipe or a bigger upgrade budget. See the [Professions](/app/professions) info page for the full per-level breakdown.

---

# Trading

You can trade with another player at any time. From the **Trade** page, search a partner by character name and you'll both land in a shared trade view.

Both sides drop items, weapons, and korel into their offer panel. Each side must lock in their offer (no further changes), then both must confirm. The transfer is atomic — if validation fails, no items move.

Equipped weapons can't be traded.

---

# Weapons

Your equipped **Weapon** sets your stats and dictates what actions are available in a fight. Weapons differ in HP, Resource, and action mix.

A weapon has:
- **HP** — the survival pool you fight with. Different weapons have different HP totals.
- **Resource** — a per-weapon secondary stat with its own name (Stamina, Flow, Noko, etc.) and a maximum. Drives action costs.
- **Weight** — drives the [initiative](#the-battle) roll at battle start. Heavier weapons go later in the turn order.
- **Action sets** — Defend, Attack, and Special, plus a crit for each. You pick one Defend, Attack, or Special each turn; the matching crit fires automatically when you win the category triangle.

An **Action** has:
- **Name** — the in-game name.
- **Type** — one of the action types (see [Combat Actions](#combat-actions)).
- **Damage Type** and **Damage Subtype** — see [Damage and Resistances](#damage-and-resistances).
- **Field** or **Value** — the variable amount the action does. Field is rolled (e.g. damage per use); Value is fixed (e.g. block amount).
- **Cost** — how much Resource it consumes. Negative cost restores Resource instead of spending it.
- **Range** — how far it reaches in tiles.
- **Aimed or Reactive** — targeting mode.
- **Rounds** — for duration actions (DOT, Buff, Debuff, Reflect, Shield), how many rounds the effect lasts.

**Each weapon you own is its own instance.** Crafting two of the same weapon produces two separate items; upgrades and enchants on one do not carry over to the other.

For per-weapon stats and the exact actions of every weapon, see the [Weapon Stats](/app/weapon-stats) info page.

---

# Items

Every item in your inventory has a type:

- **Material** — raw or processed crafting inputs (sulwood, talamite, hiruos, treated sulwood, hardwood, alloy, nodol, etc.). Used at the Bench.
- **Component** — a crafted intermediate combined into a weapon (wand base, staff base, battle axe hilt, etc.). All components are also materials.
- **Valuable** — loot from enemies meant for selling (swallow feather, venison, melstone, lifgem, etc.). Generally not used in crafting.
- **Consumable** — spent on use. Baits are the main consumables — one is consumed per hunt.
- **Permanent** — kept forever, never consumed or sold; quantity is always one. Enemy **trophies** and the free **Swallow permit** are permanent (the Swallow permit lets you hunt swallows without using up a bait).

**Higher-tier crafting.** Many weapons have alternate recipes that use higher-tier materials and bake bonuses into the finished weapon. These baked-in bonuses do not count against the [upgrade budget](#the-bench) — they're part of the recipe. See the [Professions](/app/professions) page for which recipes are available at each level and what they grant.

---

# Glossary

Quick reference. Click any term to jump to its section.

**Essentials**
- [Korel](#currency-and-stats) — the standard currency.
- [Weapon](#weapons) — your equipped loadout; determines stats and available actions.
- [Profession](#professions) — Lumberjack, Blacksmith, or Enchanter. Combined cap of 30 levels.
- [Bench](#the-bench) — your production area, split into Crafting / Upgrading / Enchanting.
- [Bait](#hunting) — consumable that summons one specific enemy.
- [Loot](#hunting) — drops rolled at end of a victorious battle.

**Combat**
- [HP](#currency-and-stats) — survival pool. Reach 0 and you lose.
- [Resource](#currency-and-stats) — per-weapon secondary stat (Stamina, Flow, etc.). Drives action costs.
- [Weight](#weapons) — per-weapon stat. Heavier weapons act later in the turn order.
- [Initiative](#the-battle) — random score rolled at battle start that decides turn order. Lower Weight tends to mean higher initiative.
- [Action](#weapons) — one entry in a weapon's set. Has a type, damage type/subtype, field/value, cost, range, aimed/reactive, and (for duration) rounds.
- [Action sets](#weapons) — every weapon has Defend, Attack, and Special, each paired with a crit.
- [Crit](#combat-actions) — a bonus action that fires when your category beats an opponent's in the Defend ▶ Attack ▶ Special ▶ Defend triangle.
- [Obstacle](#the-battle) — board feature blocking movement and aimed attacks.

**Action types** (what an Action does)
- [Strike](#combat-actions) — direct damage.
- [Block](#combat-actions) — reduces this turn's incoming damage.
- [Buff](#combat-actions) — boosts user's damage for a duration.
- [Debuff](#combat-actions) — reduces target's damage for a duration.
- [Heal](#combat-actions) — restores HP.
- [DOT](#combat-actions) — Damage Over Time; ticks each round.
- [Reflect](#combat-actions) — returns a flat amount on any incoming Strike, for a duration.
- [Shield](#combat-actions) — soaks a fixed amount of damage each round over multiple turns.
- [Slow](#combat-actions) — caps a target's movement for a few rounds.
- [Tile](#combat-actions) — a zone dropped on the board (block / buff / hazard / slow).

**Action properties** (numbers attached to an Action)
- [Field](#weapons) — roll table for a variable value (rolls one entry per use).
- [Value](#weapons) — fixed amount (e.g. block value, shield value).
- [Range](#weapons) — reach in tiles (diagonal counts as one).
- [Cost](#weapons) — Resource consumed (negative cost restores instead).
- [Rounds](#weapons) — how long a duration action lasts.
- [Aimed](#combat-actions) — you pick a target tile. Less reliable.
- [Reactive](#combat-actions) — auto-fires at nearest valid target. More reliable.
- [Duration](#combat-actions) — multi-round effects; never stack — a new application replaces the existing one.

**Damage**
- [Damage Type](#damage-and-resistances) — Physical / Arcane / Elemental.
- [Damage Subtype](#damage-and-resistances) — Sharp, Blunt, Mental, Force, Fire, Water, Poison, and more.
- [Weakness](#damage-and-resistances) — Hd4 roll (skews high).
- [Resist](#damage-and-resistances) — Ld2 roll (skews low).
- [Neutral](#damage-and-resistances) — 1d roll (baseline).

**Turn flow**
- [Intent phase](#the-battle) — choose your move + action.
- [Move phase](#the-battle) — every combatant executes their movement step in initiative order.
- [Action phase](#the-battle) — Defend → Attack → Special → DOT ticks, in initiative order, with crits firing alongside their trigger.

**Production**
- [Crafting](#the-bench) — turn materials into weapons, intermediates, reagents.
- [Upgrading](#the-bench) — permanently boost a weapon of your own profession.
- [Enchanting](#the-bench) — apply one of four enchant kinds to a weapon's three slots.
- [Health enchant](#the-bench) — adds flat HP.
- [Melee enchant](#the-bench) — adds a short-range Sidaev Strike.
- [Ranged enchant](#the-bench) — adds a longer-range Sidaev Pulse.
- [Upgrade enchant](#the-bench) — boosts one existing action and can change its damage type.

**Items**
- [Material](#items) — raw or processed crafting input.
- [Component](#items) — crafted intermediate combined into a weapon. All components are also materials.
- [Valuable](#items) — loot meant for selling.
- [Consumable](#items) — single-use item (baits are the main example).
- [Permanent](#items) — kept forever, never consumed or sold (trophies, the Swallow permit).
