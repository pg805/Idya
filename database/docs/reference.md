# Currency and Stats

**Korel** is the standard currency. Earned by selling loot to shops. Used to buy weapons, baits, and materials.

**Health (HP)** is your survival pool in a fight. Drops to zero, you lose the battle.

**Resource** is a per-weapon secondary stat. Each weapon has its own — Stamina for an axe, Luck for a deck of cards — and most attacks cost some to use. Most weapons have a dedicated action to restore it.

---

# Combat Actions

Every weapon has three action sets, plus an attack crit:

- **Defend**
- **Attack** and **Attack Crit**
- **Special**

You pick one Defend, Attack, or Special each turn. The **Attack Crit** is a bonus action that fires automatically when conditions are met (see Crits below).

Actions come in eight types. Some take effect immediately, others apply a duration over several rounds. **Duration effects never stack** — applying a new one replaces the existing one on the same target.

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

**Field** is the roll table for any value that varies — usually the damage on a Strike or DOT tick. `Field: [0, 1, 2, 5, 6, 7, 8]` means each use picks one of those values at random.

**Range** is how far the action can reach, measured in tiles (diagonals count as one step).

**Aimed vs Reactive**:
- **Aimed** — you pick a target tile before the attack fires. Less reliable, requires prediction.
- **Reactive** — fires automatically at the nearest valid target in range. More reliable.
- **Self-targeting** — Heal and Buff actions target the user automatically; no tile selection.

**Attack Crit** fires when you use an Attack and your target uses a Special on the same turn. The crit lands **after** the main attack.

**Damage calculation.** When a Strike lands, the rolled damage is adjusted by the attacker's active Buff (added) and Debuff (subtracted), then reduced by the target's Block and Shield. Final damage cannot go below 0.

- **Buff and Debuff are mutually exclusive on the same target.** Applying one clears the other.
- **Block resets at end of round.** It must be re-applied each round.
- **Shield is not a depleting pool.** Its value subtracts from incoming damage each round for the duration.
- **Reflect fires on any incoming Strike** regardless of damage landed, and sends a flat amount back.

---

# Damage and Resistances

Every action carries a **Damage Type** and a **Damage Subtype**. Any type/subtype combination is possible (an action can be Arcane Sharp or Elemental Blunt — enchants make these mixes).

**Damage Types** and their typical subtypes:
- **Physical** — Sharp, Blunt
- **Arcane** — Mental, Force
- **Elemental** — Fire, Water, Earth, Wind, Plant

Enemies have **Resistances** against each type and subtype. Your action's type and subtype are evaluated against the enemy's, and the result maps to a roll mode:

| Matchup | Roll mode | Behavior |
|---|---|---|
| **Weakness** | **Hd4** | Roll 4 dice, take the highest. Big variance, skews high. |
| **Resist** | **Ld2** | Roll 2 dice, take the lowest. Skews low. |
| **Neutral** | **1d** | Single roll. Baseline. |

The combat log marks these with `[weakness — Hd4]` or `[resist — Ld2]` when active. Type matchups shift the roll distribution; they don't apply a flat damage multiplier.

---

# The Battle

Battles are turn-based on a grid against one or more enemies from the [Enemies](/app/enemies) roster. Every combatant begins at **full HP and full Resource**.

At the start of every battle, every combatant rolls for **initiative** — a random score that decides turn order for the whole fight. Lighter weapons (lower **Weight**) roll higher on average and act earlier. The rolls appear at the top of the combat log in the order combatants will act. On a tie, the player wins against an NPC; otherwise it's a coin flip.

Each turn unfolds in three phases:

1. **Intent phase** — every combatant picks a move target and an action for the turn.
2. **Move phase** — every combatant executes their movement step in initiative order. If two combatants want the same tile, the higher-initiative one takes it; the other re-routes toward its original destination, or stays put if it can't get any closer.
3. **Action phase** — actions resolve in a fixed order:
   - **Defend actions**
   - **Attack actions** (including Attack Crit triggers)
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
| Sulfolk Bait | Sulfolk |
| Wyrm Bait | Talwyrm |
| Deer Bait | Daefen Deer |
| Toad Bait | Maetoad |
| Tar Bait | Golnosar |
| Bear Bait | Melbear |

**Loot** is rolled at the end of a victorious battle. Each enemy has a drop table — see the [Enemies](/app/enemies) info page for exact roll tables.

Each hunt rolls a fresh board layout with obstacles placed randomly in the open zone.

**A bait occasionally pulls a second enemy of the same type** — about a 2.3% chance per hunt. Both must be defeated, each drops loot, and the combat log distinguishes them with an `A` / `B` suffix. Their action patterns start offset so they don't move in sync.

---

# Town Shops

Sulku'it has four shops. Each one buys back items at a sell price and stocks goods at a buy price.

- [**General Store**](/app/shop/general_store) (Dolan) — baits, miscellaneous valuables.
- [**Blacksmith**](/app/shop/blacksmith) (Kethalis) — talamite materials, metal weapons, blacksmith components.
- [**Lumberjack**](/app/shop/lumberjack) (Vetha) — sulwood materials, wood weapons, lumber components.
- [**Enchanting Shop**](/app/shop/enchanting_shop) (Lomis) — enchanting reagents, arcane weapons, valuable gemstones.

Prices move with the market. Shops respond to player trading: heavy buying pushes prices up, heavy selling pushes them down. Some items (valuables) swing harder; bulk materials shift more slowly. Idle items drift back toward their baseline.

If a shop's shelf is full of an item, it stops buying that item until stock clears. Shops dump excess stock on their own schedule.

---

# The Bench

The **Bench** is where materials become items, weapons, and enchants. It splits into three pages, one per profession:

- [**Crafting**](/app/crafting) — combine materials and components into finished weapons, intermediates, and enchanting reagents. Weapons crafted from higher-tier components come with bonuses baked in (see [Items](#items)).
- [**Upgrading**](/app/upgrade) — spend tier-2 or tier-3 material on a weapon you own to permanently boost its stats. Each profession has its own upgrade budget per weapon.
- [**Enchanting**](/app/enchant) — apply an enchant to one of a weapon's three enchant slots. A **minor** enchant changes the **Damage Subtype** of one action and adds a small bonus. A **major** enchant changes both **Damage Type** and **Damage Subtype** and adds a large bonus (+3). Three enchant slots per weapon, one enchant per action, permanent.

---

# Professions

There are three professions: **Lumberjack (LJ)**, **Blacksmith (BS)**, and **Enchanter**. You can level each one from 1 to 10, with a combined cap of 30 across all three.

The cost of a level depends on your **total** profession levels across all three. Your 1st level (in any profession) is cheap; your 30th — the last one to reach the cap — is expensive. The profession you put it into doesn't change the price, even if it's a lower level than another profession.

Picking up a second or third profession late costs more total korel and materials than specializing. Players are expected to trade to cover gaps in their own professions.

You raise profession levels on your [Character](/app/character) page.

| Profession | What it crafts | What it upgrades |
|---|---|---|
| Lumberjack | Wood and hybrid weapons | Any weapon containing a wood component |
| Blacksmith | Metal weapons | Any weapon containing talamite |
| Enchanter | Enchanter-tree weapons (spellbook, wand, kustaff, deck of cards, mental cage) | Enchanter-tree weapons |

Hybrid weapons (Sword (Talamite), Axe (Talamite), Shovel (Talamite)) have both wood and talamite parts, so **both** LJ and BS can upgrade them.

Enchanting is a separate system from upgrades. Any profession's weapon can receive enchants (apply via the Enchanting page above).

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
- **Resource** — a per-weapon secondary stat with its own name (Stamina, Luck, Energy, etc.) and a maximum. Drives action costs.
- **Weight** — drives the [initiative](#initiative) roll at battle start. Heavier weapons go later in the turn order.
- **Action sets** — Defend, Attack (+ Attack Crit), and Special. You pick one Defend, Attack, or Special each turn; Attack Crit fires automatically.

An **Action** has:
- **Name** — the in-game name.
- **Type** — one of the eight types ([Strike, Block, Buff, Debuff, Heal, DOT, Reflect, Shield](#combat-actions)).
- **Damage Type** and **Damage Subtype** — see [Damage and Resistances](#damage-and-resistances).
- **Field** or **Value** — the variable amount the action does. Field is rolled (e.g. damage per use); Value is fixed (e.g. block amount).
- **Cost** — how much Resource it consumes. Negative cost restores Resource instead of spending it.
- **Range** — how far it reaches in tiles.
- **Aimed or Reactive** — targeting mode.
- **Rounds** — for duration actions (DOT, Buff, Debuff, Reflect, Shield), how many rounds the effect lasts.

**Each weapon you own is its own instance.** Crafting two Quarterstaffs produces two separate items; upgrades and enchants on one do not carry over to the other.

For per-weapon stats and the exact actions of every weapon, see the [Weapon Stats](/app/weapon-stats) info page.

---

# Items

Every item in your inventory has a type:

- **Material** — raw or processed crafting inputs (sulwood, talamite, hiruos, treated sulwood, hardwood, alloy, nodol, etc.). Used at the Bench.
- **Component** — a crafted intermediate combined into a weapon (sword hilt, axe head, wand base, etc.). All components are also materials.
- **Valuable** — loot from enemies meant for selling (swallow feather, venison, melstone, lifgem, etc.). Generally not used in crafting.
- **Consumable** — spent on use. Baits are the main consumables — one is consumed per hunt.

**Higher-tier crafting**. Many weapons have alternate recipes that use higher-tier components and bake bonuses into the crafted weapon:

- **Tier-2 recipes** — use tier-2 components (treated sulwood, talamite, hiruos). The crafted weapon comes with **+1 attack** baked in. The three starting weapons each have a tier-2 variant: **Quarterstaff (Treated)** at LJ level 2, **Dagger (Talamite)** at BS level 2, and **Spellbook (Hiruos)** at EN level 2.
- **Tier-3 recipes** — use tier-3 components (hardwood, alloy, nodol). The crafted weapon comes with **+1 defend, +1 attack, +1 special** baked in. Every weapon has a tier-3 variant, unlocking at profession level 7.

These baked-in bonuses do not count against the [upgrade budget](#the-bench) — they are part of the recipe. A hardwood quarterstaff arrives at +1/+1/+1 with no upgrade points spent.

See the [Professions](/app/professions) info page for the full list of which recipes are available at each level.

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
- [Resource](#currency-and-stats) — per-weapon secondary stat (Stamina, Luck, etc.). Drives action costs.
- [Weight](#weapons) — per-weapon stat. Heavier weapons act later in the turn order.
- [Initiative](#the-battle) — random score rolled at battle start that decides turn order. Lower Weight tends to mean higher initiative.
- [Action](#weapons) — one entry in a weapon's set. Has a type, damage type/subtype, field/value, cost, range, aimed/reactive, and (for duration) rounds.
- [Action sets](#weapons) — every weapon has Defend, Attack (+ Attack Crit), and Special sets.
- [Obstacle](#the-battle) — board feature blocking movement and aimed attacks.

**Action types** (what an Action does)
- [Strike](#combat-actions) — direct damage.
- [Block](#combat-actions) — reduces this turn's incoming damage.
- [Buff](#combat-actions) — boosts user's damage for a duration.
- [Debuff](#combat-actions) — reduces target's damage for a duration.
- [Heal](#combat-actions) — restores HP.
- [DOT](#combat-actions) — Damage Over Time; ticks each round.
- [Reflect](#combat-actions) — returns a portion of incoming damage for a duration.
- [Shield](#combat-actions) — soaks a fixed amount of damage over multiple turns.

**Action properties** (numbers attached to an Action)
- [Field](#weapons) — roll table for a variable value (rolls one entry per use).
- [Value](#weapons) — fixed amount (e.g. block value, shield value).
- [Range](#weapons) — reach in tiles (diagonal counts as one).
- [Cost](#weapons) — Resource consumed (negative cost restores instead).
- [Rounds](#weapons) — how long a duration action lasts.
- [Aimed](#combat-actions) — you pick a target tile. Less reliable.
- [Reactive](#combat-actions) — auto-fires at nearest valid target. More reliable.
- [Attack Crit](#combat-actions) — bonus action when your Attack meets enemy Special. Resolves after the main attack.
- [Duration](#combat-actions) — multi-round effects; never stack — a new application replaces the existing one.

**Damage**
- [Damage Type](#damage-and-resistances) — Physical / Arcane / Elemental.
- [Damage Subtype](#damage-and-resistances) — Sharp, Blunt, Mental, Force, Fire, Water, Earth, Wind, Plant.
- [Weakness](#damage-and-resistances) — Hd4 roll (skews high).
- [Resist](#damage-and-resistances) — Ld2 roll (skews low).
- [Neutral](#damage-and-resistances) — 1d roll (baseline).

**Turn flow**
- [Intent phase](#the-battle) — choose your move + action.
- [Move phase](#the-battle) — both sides execute their movement step.
- [Action phase](#the-battle) — Defend → Attack → Special → DOT ticks. Player resolves before AI except DOTs (AI first).

**Production**
- [Crafting](#the-bench) — turn materials into weapons, intermediates, reagents.
- [Upgrading](#the-bench) — permanently boost a weapon's stats.
- [Enchanting](#the-bench) — apply an enchant to one of a weapon's three slots.
- [Minor enchant](#the-bench) — changes Damage Subtype, small bonus.
- [Major enchant](#the-bench) — changes Damage Type and Subtype, +3 bonus.
- [Hybrid weapon](#professions) — has wood and talamite parts; both LJ and BS can upgrade.

**Items**
- [Material](#items) — raw or processed crafting input.
- [Component](#items) — crafted intermediate combined into a weapon (sword hilt, axe head, etc.). All components are also materials.
- [Valuable](#items) — loot meant for selling.
- [Consumable](#items) — single-use item (baits are the main example).
- [Tier-2 recipe](#items) — alternate recipe for the L1 weapons (Quarterstaff, Dagger, Spellbook) using treated sulwood / talamite / hiruos. Crafted weapon comes with +1 attack baked in.
- [Tier-3 recipe](#items) — alternate recipe for every weapon using hardwood / alloy / nodol. Crafted weapon comes with +1 defend / +1 attack / +1 special baked in.
