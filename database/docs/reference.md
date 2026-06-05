# Currency and Stats

**Korel** is the standard currency. Stamped with Emperor Gustavus's face. Earned by selling loot to shops and from battle rewards. Used to buy weapons, baits, materials, and upgrades.

**Health (HP)** is your survival pool in a fight. Drops to zero, you lose the battle.

**Resource** is a per-weapon secondary stat. Each weapon has its own — Stamina for an axe, Tar for a Golnosar — and most attacks cost some to use. Defensive actions usually restore it. Different weapons play very differently because of their resource rhythm.

---

# Combat Actions

Every weapon has six action sets:

- **Defend** and **Defend Crit**
- **Attack** and **Attack Crit**
- **Special** and **Special Crit**

You pick one Defend, Attack, or Special each turn. The "Crit" variants are bonus actions that fire automatically when conditions are met (see Crits below).

Actions come in eight types:

- **Strike** — direct damage
- **Block** — reduces incoming damage this turn
- **Buff** — adds an effect that helps the user (e.g., boosts damage)
- **Debuff** — adds an effect that hurts the target (e.g., reduces their damage)
- **Heal** — restores HP
- **DOT (Damage Over Time)** — ticks damage for several rounds after it lands
- **Reflect** — sends a portion of incoming damage back at the attacker
- **Shield** — soaks a fixed amount of damage over multiple turns

**DOTs do not stack.** A new DOT replaces the existing one on the same target.

**Field** is the damage roll table for an attack. `Field: [0, 1, 2, 5, 6, 7, 8]` means each hit picks one of those values at random. A wider range means swingier; a tighter range means predictable.

**Range** is how far the action can reach measured in tiles (diagonals count as one step).

**Aimed vs Reactive**:
- **Aimed** — you pick a target tile before the attack fires. Lets you hit specific positions or save a powerful attack for a moment when the enemy is in range.
- **Reactive** — fires automatically at the nearest valid target in range. Less control, more reliable.

**Crits (`attack_crit`)** fire when you use an Attack and your target uses a Special on the same turn. The crit lands *before* the main attack. Defend Crit and Special Crit work analogously for those action types.

---

# Damage and Resistances

Every action carries a **Damage Type** and a **Damage Subtype**.

**Damage Types**
- **Physical** — Sharp, Blunt, Poison
- **Arcane** — Mental, Force
- **Elemental** — Fire, Water, Earth, Wind, Plant

Enemies have **Resistances** as multiplier scores against each type and subtype. Your action's type score and subtype score multiply together. The combined number doesn't directly multiply damage — it changes the *shape* of the roll:

- Combined > 1.0 — **weakness** — roll 4 dice, take the highest (Hd4). Big variance, skews high.
- Combined < 1.0 — **resist** — roll 2 dice, take the lowest (Ld2). Skews low.
- Combined = 1.0 — **neutral** — single roll. Baseline.

The combat log marks these with `[weakness — Hd4]` or `[resist — Ld2]` when active. Matching damage types to enemy weaknesses isn't always a guaranteed bonus, but it dramatically shifts the odds in your favor.

---

# The Battle

Battles are turn-based on a small grid. Each turn unfolds in three phases:

1. **Intent** — you and the enemy each choose an action.
2. **Move** — both sides take their movement step.
3. **Action** — Defends resolve first, then Attacks, then Specials. Within each sub-phase, the player resolves before the AI.

You and your enemy share the board. Position matters: range, line of sight, and which tiles get blocked by obstacles all shape what's possible. The board includes **obstacles** — rolled randomly per hunt — that block both movement and aimed attacks. Diagonal moves can't slip between two obstacles that touch corners.

DOTs tick at end of round. If a fight ends with both combatants dying to DOT damage on the same tick, the AI's DOT resolves first, then yours — death is checked between.

---

# Hunting

Hunts happen on the **Hunt** page. Each hunt costs one **bait** from the General Store, and each bait summons one specific enemy:

| Bait | Enemy |
|---|---|
| Swallow Bait | Lithkem Swallow |
| Sulfolk Bait | Sulfolk |
| Wyrm Bait | Talwyrm |
| Deer Bait | Daefen Deer |
| Toad Bait | Maetoad |
| Tar Bait | Golnosar |
| Bear Bait | Melbear |

**Loot** is rolled at the end of a victorious battle, not per turn. Each enemy has a drop table — see the **Enemies** info page for the exact roll tables.

Each hunt rolls a fresh board layout: 2–6 obstacles placed randomly in the open zone. The tutorial board is fixed.

---

# Town Shops

Sulku'it has four shops. Each one buys back items at a sell price and stocks goods at a buy price.

- **General Store** (Dolan) — baits, miscellaneous valuables.
- **Blacksmith** (Kethalis) — talamite materials, metal weapons, blacksmith components.
- **Lumberjack** (Vetha) — sulwood materials, wood weapons, lumber components.
- **Enchanting Shop** (Lomis) — enchanting reagents, arcane weapons, valuable gemstones.

**Prices move with the market.** Shops respond to player trading: heavy buying pushes prices up, heavy selling pushes them down. Some items (valuables) swing harder; bulk materials shift more slowly. Idle items drift back toward their baseline.

If a shop's shelf is full of an item, it stops buying that item until stock clears. Shops dump excess stock on their own schedule to keep things flowing.

---

# The Bench

The **Bench** is where you turn materials into things. It splits into three pages, one per profession:

- **Crafting** — combine materials and components into finished weapons, intermediates, and enchanting reagents. The recipe is fixed; you provide the inputs.
- **Upgrading** — spend tier-2 or tier-3 material on a weapon you own to permanently boost its stats. Each profession has its own upgrade budget per weapon.
- **Enchanting** — apply an enchant to one of a weapon's three enchant slots. Enchants change an action's damage subtype (minor) or its full damage type and subtype (major). Three enchant slots per weapon, one enchant per action, permanent.

---

# Professions

There are three professions: **Lumberjack (LJ)**, **Blacksmith (BS)**, and **Enchanter**. You can level each one from 1 to 10. Total combined level is capped at 30, so leveling all three to max is possible but takes work.

| Profession | What it crafts | What it upgrades |
|---|---|---|
| Lumberjack | Wood and hybrid weapons | Any weapon with a wood component |
| Blacksmith | Metal weapons | Talamite-only weapons (no wood handle) |
| Enchanter | Enchanting reagents and arcane weapons | All weapons (via enchants) |

Hybrid weapons (Sword (Talamite), Axe (Talamite), Shovel (Talamite)) can be upgraded by **either** LJ or BS — cross-profession collaboration is intentional.

Each profession level grants either a new recipe or a bigger upgrade budget. See the **Professions** info page for the full per-level breakdown.

---

# Trading

You can trade with another player at any time. From the **Trade** page, search a partner by character name, and you'll both land in a shared trade view.

Both sides drop items, weapons, and **korel** into their offer panel. Each side must **lock in** their offer (no further changes), then both must **confirm**. The transfer happens atomically — if anything goes wrong, nobody loses anything.

Equipped weapons can't be traded. Unequip first if you want to send one across.

---

# The Pages

The sidebar groups everything you'll touch into four areas.

**Top group** (your character and the world):
- **Character** — your sprite, stats, profession levels.
- **Inventory** — your items and weapons. Equip weapons from here.
- **Hunt** — pick a bait, start a battle.
- **Trade** — open a trade session with another player.

**Bench** (production):
- **Crafting**, **Upgrading**, **Enchanting** — described above.

**Town** (the four shops): General Store, Blacksmith, Lumberjack, Enchanting Shop.

**Info** (reference, no game state changes):
- **Professions** — per-level recipe and budget breakdown.
- **Enemies** — drop tables for every enemy.
- **Weapon Stats** — action stats and damage fields for every weapon.
- **Lore** — the world, its peoples, the town.
- **Reference** — this page.
