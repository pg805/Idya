# Currency and Stats

**Korel** is the standard currency. Earned by selling loot to shops and from battle rewards. Used to buy weapons, baits, materials, and upgrades.

**Health (HP)** is your survival pool in a fight. Drops to zero, you lose the battle.

**Resource** is a per-weapon secondary stat. Each weapon has its own — Stamina for an axe, Energy for a deck of cards — and most attacks cost some to use. Most weapons have a dedicated action to restore it. Different weapons play very differently because of their resource rhythm.

---

# Combat Actions

Every weapon has three action sets, plus an attack crit:

- **Defend**
- **Attack** and **Attack Crit**
- **Special**

You pick one Defend, Attack, or Special each turn. The Attack Crit is a bonus action that fires automatically when the conditions are met (see Crits below).

Actions come in eight types. Some take effect immediately, others apply a duration over several rounds. **Duration effects never stack** — applying a new one replaces the existing one on the same target.

| Type | Effect | Duration |
|---|---|---|
| **Strike** | Direct damage | Immediate |
| **Block** | Reduces incoming damage this turn | Immediate (this turn only) |
| **Buff** | Boosts the user's damage | Duration |
| **Debuff** | Reduces the target's damage | Duration |
| **Heal** | Restores HP | Immediate |
| **DOT** (Damage Over Time) | Damage that ticks each round | Duration |
| **Reflect** | Sends a portion of incoming damage back | Duration |
| **Shield** | Soaks a fixed amount of damage | Duration |

**Field** is the roll table for any value that varies — damage on a Strike, damage per tick on a DOT, even shield/block values. `Field: [0, 1, 2, 5, 6, 7, 8]` means each use picks one of those values at random. A wider range is swingier; a tighter range is more predictable.

**Range** is how far the action can reach, measured in tiles (diagonals count as one step).

**Aimed vs Reactive**:
- **Aimed** — you pick a target tile before the attack fires. Less reliable, because the target can move off the tile.
- **Reactive** — fires automatically at the nearest valid target in range. More reliable.

**Crits** — `attack_crit` fires when you use an Attack and your target uses a Special on the same turn. The crit lands **after** the main attack.

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

The combat log marks these with `[weakness — Hd4]` or `[resist — Ld2]` when active. Matching damage types to enemy weaknesses isn't a guaranteed bonus, but it dramatically shifts the odds in your favor.

---

# The Battle

Battles are turn-based on a small grid. You and your enemy submit your choices each turn, then resolution runs in two phases:

1. **Move phase** — both sides execute their movement step.
2. **Action phase** — Defends resolve first, then Attacks, then Specials. Within each sub-phase, the player resolves before the AI.

Position matters: range, line of sight, and which tiles get blocked by **obstacles** all shape what's possible. Obstacles are rolled randomly per hunt and block both movement and aimed attacks. Diagonal moves can't slip between two obstacles that touch corners.

**The battle ends the moment any character reaches 0 HP — they're the loser.** DOTs tick at end of round and are checked the same way: whoever drops first is the loser.

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

**Loot** is rolled at the end of a victorious battle, not per turn. Each enemy has a drop table — see the [Enemies](/app/enemies) info page for exact roll tables.

Each hunt rolls a fresh board layout: 2–6 obstacles placed randomly in the open zone.

---

# Town Shops

Sulku'it has four shops. Each one buys back items at a sell price and stocks goods at a buy price.

- **General Store** (Dolan) — baits, miscellaneous valuables.
- **Blacksmith** (Kethalis) — talamite materials, metal weapons, blacksmith components.
- **Lumberjack** (Vetha) — sulwood materials, wood weapons, lumber components.
- **Enchanting Shop** (Lomis) — enchanting reagents, arcane weapons, valuable gemstones.

Prices move with the market. Shops respond to player trading: heavy buying pushes prices up, heavy selling pushes them down. Some items (valuables) swing harder; bulk materials shift more slowly. Idle items drift back toward their baseline.

If a shop's shelf is full of an item, it stops buying that item until stock clears. Shops dump excess stock on their own schedule to keep things flowing.

---

# The Bench

The **Bench** is where you turn materials into things. It splits into three pages, one per profession:

- **Crafting** — combine materials and components into finished weapons, intermediates, and enchanting reagents.
- **Upgrading** — spend tier-2 or tier-3 material on a weapon you own to permanently boost its stats. Each profession has its own upgrade budget per weapon.
- **Enchanting** — apply an enchant to one of a weapon's three enchant slots. A **minor** enchant changes the **Damage Subtype** of one action; a **major** enchant changes both **Damage Type** and **Damage Subtype** (and adds a small bonus). Three enchant slots per weapon, one enchant per action, permanent.

---

# Professions

There are three professions: **Lumberjack (LJ)**, **Blacksmith (BS)**, and **Enchanter**. You can level each one from 1 to 10. Total combined level is capped at 30 — that's enough to max two and leave one at 10, or spread your levels more evenly. The cap means specializing is encouraged: you can't be the master of everything, and other players are expected to fill the gaps via trade.

| Profession | What it crafts | What it upgrades |
|---|---|---|
| Lumberjack | Wood and hybrid weapons | Any weapon containing a wood component |
| Blacksmith | Metal weapons | Any weapon containing talamite |
| Enchanter | Enchanter-tree weapons (spellbook, wand, kustaff, deck of cards, mental cage) | Enchanter-tree weapons |

Hybrid weapons (Sword (Talamite), Axe (Talamite), Shovel (Talamite)) have both wood and talamite parts, so **both** LJ and BS can upgrade them — cross-profession collaboration is intentional.

Enchanting is a separate system from upgrades. Any profession's weapon can receive enchants (apply via the Enchanting page above).

Each profession level grants either a new recipe or a bigger upgrade budget. See the [Professions](/app/professions) info page for the full per-level breakdown.

---

# Trading

You can trade with another player at any time. From the **Trade** page, search a partner by character name and you'll both land in a shared trade view.

Both sides drop items, weapons, and korel into their offer panel. Each side must lock in their offer (no further changes), then both must confirm. The transfer happens atomically — if anything goes wrong, nobody loses anything.

Equipped weapons can't be traded.
