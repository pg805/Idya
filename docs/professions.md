# Professions

Status: **decided list, undecided detail.** The set below is agreed. What each one
owns beyond its material, how ranks work, and which are load-bearing are open.

Constraints these have to satisfy live in [`design-rules.md`](design-rules.md),
rules 1, 2, 7 and 9.

---

## The principle

**Professions own materials, not weapons.** A weapon is an *assembly* of parts from
several professions, which is why a sword needs a carpenter and a blacksmith and a
quarterstaff needs only a carpenter.

This is `world.md` §14, and it is the thing that makes rule 1 work: the tool you need
to start an activity comes from whoever owns the material it is made of. It also
means the question "what professions should exist" reduces to **"what materials does
the world produce"**, which is a much easier question with better answers.

The name should describe *production*, not a service performed on an existing object.
That is why Enchanter became Artificer, and Lumberjack became Carpenter — an
enchanter modifies, an artificer makes.

---

## The six

| Profession | Owns | Makes |
|---|---|---|
| **Carpenter** | Wood | Hafts, staves, handles, bows. The quarterstaff outright. |
| **Blacksmith** | Metal | Blades, heads, plate. |
| **Artificer** | Arcane | Wands, foci, and the enchant layer. |
| **Apothecary** | Herbs | Balms, salves, ointments, antidotes. Everything herbal. |
| **Tanner** | Hide and leather | Light armour, grips, packs. |
| **Cleric** | Sacred | Holy weapons, and the non-herbal half of consumables. |

**Cleric and Apothecary split on herb or not herb.** That is the line: anything made
from plants is the apothecary's, anything sacred is the cleric's, and both make things
that fix people.

**Cleric makes weapons.** This is a change from `world.md`, which has the cleric as a
service profession with no weapon parts. Holy weapons are now theirs.

**Renames from the current build:** Lumberjack → Carpenter, Enchanter → Artificer.
Both appear in code as `WEAPON_PROFESSION` in `src/economy/upgrade_service.ts`, along
with the whole per-profession upgrade and enchant machinery.

**Cleric** is from `world.md`: the fourth profession and the first service profession,
religious across a variety of forces rather than one church, with allegiance a
separate axis from the profession. Clerics can heal themselves.

---

## Later, not rejected

Wanted, just not in the starting set.

- **Mason** (stone) — lands naturally if building and land happen.
- **Weaver** (fibre and cloth) — robes, bandages, bags. Also the obvious third owner
  of armour slots alongside metal and leather.
- **Cook** (food) — food already gates combat and labour, so the material exists and
  has a faucet even though the profession does not yet.

---

## Open

1. **Is there a `sacred` stat?** If the cleric makes holy weapons, something has to make
   them holy. The symmetric answer is an eighth weapon stat beside `magic`, so a holy
   mace scales sacred abilities the way a wand scales arcane ones.

   The risk is where it stops — why not a poison stat for the apothecary, a nature
   stat, and so on until there are twenty. A principled stop: **a delivery stat exists
   only when a profession owns the material that produces casting implements.**
   Artificer owns arcane, Cleric owns sacred, and that closes the set at two. Carpenter,
   Blacksmith and Tanner produce physical things, which `striker` and `breaker` already
   cover; the Apothecary's output is consumables, not weapon scaling.

2. **What is the sacred material?** Every other profession owns something the world
   produces from a faucet. Sacred does not have one yet, and without it the cleric has
   no supply chain — which matters more now that they make weapons rather than only
   services.
3. **Which of the six are load-bearing?** A load-bearing profession is one where
   something is *impossible* without it; an enriching one makes things better but
   nothing stops. Every profession added is another node the dependency graph can be
   missing, and rule 9 puts every missing node on the GM. The load-bearing set should
   stay small, and it should be chosen rather than discovered.
4. **Armour slots versus material owners.** Head, chest, legs, boots and pack want to
   come from more than one profession, or the tanner makes the entire armour system
   alone. Metal plate and leather splitting the slots is the obvious answer; cloth
   would want the weaver back.
5. **Does the profession set change what a weapon assembly needs?** Five starter
   weapons currently need Carpenter, Blacksmith and Artificer. Tanner, Apothecary and
   Cleric contribute nothing to a weapon, which is fine if they own armour and
   consumables instead — but worth stating deliberately.
