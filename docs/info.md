# Game Info

## Commands

| Command | What it does |
|---|---|
| `/battle` | Start the tutorial |
| `/hunt [bait]` | Start a real battle — consumes one bait item |
| `/profile` | View your HP, korel, inventory, and weapons |
| `/weapon` | Equip a weapon from your collection |
| `/shop` | Open the shop — buy, sell, and train professions |
| `/craft` | Open the crafting menu |

---

## How the Game Works

Start with `/battle` to run through the tutorial. After that, buy bait from the General Store and use `/hunt` to fight real enemies.

Each fight is turn-based. You and the enemy pick actions simultaneously each round — strike, block, buff, and more. Win to earn korel and loot. Lose and you'll pay a 10% korel healing fee before you can fight again.

---

## Korel

Korel is the game's currency. You earn it by winning battles and spend it at shops and on profession training. If you lose a fight, 10% of your korel is deducted as a healing fee.

---

## Shops

Open any shop with `/shop`. Prices shift dynamically based on supply and demand — buying drives prices up, selling drives them down.

| Shop | Shopkeeper | Sells |
|---|---|---|
| General Store | Dolan | Bait, valuables |
| Blacksmith | Kethalis | Metal weapons and components |
| Lumberjack Shop | — | Wood weapons and components |
| Enchanting Shop | — | Enchanting materials |
| Temple | — | Coming soon |

You can also sell items back to shops, and train your professions from the shop screen.

---

## Professions & Crafting

There are three professions, each leveling from 1 to 10. Your combined level cap across all three is 30.

| Profession | Crafts |
|---|---|
| Lumberjack | Wood and hybrid weapons |
| Blacksmith | Metal weapons |
| Enchanter | Enchanted weapons and reagents |

Train a profession from the relevant shop screen using `/shop`. Higher levels unlock new recipes and more upgrade budget. Open the crafting menu with `/craft` to browse what you can make and check ingredient availability.

Materials come in tiers — raw, treated/smelted, and hardened — each unlocked at higher profession levels.

---

## Weapon Upgrades & Enchants

### Upgrades
Each profession gives you an upgrade budget based on your level. Spend that budget to improve your weapons using the appropriate materials. Some weapons can be upgraded by more than one profession.

### Enchants
Weapons have up to 3 enchant slots. Enchants are permanent and change the damage type or subtype of an action. There are three enchant categories:

- **Physical** — sharp, blunt
- **Arcane** — mental, force
- **Elemental** — fire, water, earth, wind, plant

Minor enchants (unlocked earlier) change subtype only. Major enchants (higher level) change both damage type and subtype, and cost more materials.

---

## Combat Terms

**Aimed** — you select a target tile before the attack resolves.

**Reactive** — fires automatically without targeting a specific tile.

**DOT (damage over time)** — deals damage each round. Applying a second DOT replaces the first — they don't stack.

**Crit** — a bonus attack that fires when you use an Attack action the same round the enemy uses their Special. Applies before the main attack.

**Damage types** — every action has a type (Arcane, Physical, or Elemental) and a subtype (sharp, blunt, mental, poison, etc.). Enemies have resistances that affect how much damage they take.

**Weakness** — if the combined resistance score is above 1.0, the damage roll is skewed high with more variance.

**Resist** — if the score is below 1.0, the damage roll is skewed low.

**Neutral** — a score of exactly 1.0 means a standard roll with no modifier.
