# Orchard — the Lumberjack's profession layer

The Lumberjack's equivalent of Enchanting: a set of **plots** that multiply a
planted item over time. The aim is to give Lumberjacks a way to pull in a bunch
of (cheap) materials a little faster than the other professions — which also
offsets the fact that LJ is currently the grindiest profession to max.

This is the first **profession special layer**; build it as a clean service
(`orchard_service.ts`, mirroring `enchant_service.ts`) so the Blacksmith's
eventual layer can follow the same shape.

## Plots — gated by Lumberjack rank

Plots unlock at the **same ranks Enchanters unlock enchant levels** (2/4/6/8/10).
Both the plot **count** and the per-plot **capacity** grow, so a higher-rank
orchard is more *and* bigger:

| LJ rank | 2 | 4 | 6 | 8 | 10 |
|---|---|---|---|---|---|
| plots | 1 | 2 | 3 | 4 | 5 |
| capacity (seed units/plot) | 10 | 15 | 20 | 25 | 30 |

(Below rank 2: no orchard. A plot count/capacity is `max` across the unlocked
tiers for the player's current rank.)

## Planting

- Plant **one item** per plot, up to that plot's capacity (`n ≤ capacity`).
- **Plantable** = any inventory item EXCEPT weapons and `unlock`-type permits
  (e.g. swallow bait — it has no `base_sell`, so it's excluded for free). Anything
  with a `base_sell` is fair game, including crafting components (a scythe head,
  etc.). The yield math makes expensive items pointless on their own.
- **The seed is lost** — planting consumes the units; they're the plot's
  permanent investment. Clearing a plot to switch items forfeits the seed.

## Yield

Each plot accrues yield of the planted item on a **4-hour** tick. The multiply
chance is **inversely proportional to the item's base price**, so value per tick
is roughly flat across items while *unit count* favours cheap mats:

```
p          = clamp(K / base_sell, 0, P_MAX)      # per-seed-unit multiply chance
yield/tick = random count with mean (n · p)       # Poisson(n·p) — integer, gambly
value/tick ≈ n · p · base_sell ≈ n · K            # ~flat across items (unclamped)
```

- **`K`** is the single balance knob (korel-value each seeded unit makes per tick).
  Start ~**0.4**; tune in `pacing_sim`.
- **`P_MAX`** (~0.5) caps the chance so the very cheapest items don't multiply
  every unit every tick.
- `base_sell` = the item's canonical base sell price, looked up from the shop
  that sells it (see Infra). No `base_sell` → unplantable.

## Harvest & the 24h cap

- Yield **accumulates** tick over tick while planted, but accrual **caps at 24h**
  (6 ticks). Past that, unharvested ticks are wasted.
- **Harvest** moves the accumulated yield into inventory, resets the accrual
  clock, and the plot **keeps its seed and resumes**. So the intended cadence is a
  **once-a-day** check: harvest daily for full value; sleep longer and you just
  cap out (you lose the overflow, not the plot).
- Implementation: each plot stores `last_collected_at`; available ticks =
  `min(6, floor((now − last_collected_at) / 4h))`.

## UI

An **Orchard** page under **Enchant** in the Bench (crafting-adjacent; reorganize
later if we want). Per plot: what's growing, seeded count, accrued yield, ticks
until cap; plant (item + qty) / harvest / clear controls. Styled like the Enchant
page.

## Infrastructure / build order

1. **Base-price accessor** — `base_sell` lookup per item, scanning the shop
   configs (cached). One helper the service reads; `null` → unplantable.
2. **DB** — `OrchardPlot` model (`character_id`, `slot`, `item_id`, `seed_count`,
   `last_collected_at`, `accrued`?) + migration. (Accrued yield can be recomputed
   from `last_collected_at` + seed, so it needn't be stored.)
3. **`orchard_service.ts`** — rank→plots/capacity, plant / harvest / clear, the
   per-tick yield math. Unit-tested on the math.
4. **Tick** — piggyback the hourly `tickAllDue` scheduler (`shop_service`); plots
   are pull-based (computed on read/harvest from `last_collected_at`), so no
   separate writer is strictly required — the cap is enforced at harvest.
5. **API + page** — `/api/orchard` (list / plant / harvest / clear) + the Orchard
   SPA page.
6. **Sim** — extend `pacing_sim` to count orchard throughput, then tune `K`.

## Open / deferred

- Exact `K` and `P_MAX` come from `pacing_sim`.
- Blacksmith's parallel layer is future work; keep the service generic enough to
  copy.
