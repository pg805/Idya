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
| capacity (seed units/plot) | 10 | 20 | 30 | 40 | 50 |

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

**The seed is the input; harvest is the output.** You plant `n` units (they leave
your inventory) and the plot produces a *rolled* output of that item over the
cycle. Harvest hands you the output — the seed does **not** come back on top. So
net = output − seed, and that can be positive or negative.

The multiply chance per seeded unit is **inversely proportional to base price**,
which makes the output's *value* roughly flat across items while *unit count*
favours cheap mats:

```
p          = clamp(K / base_sell, 0, P_MAX)      # per-seed-unit multiply chance, per tick
yield/tick = random count, mean (n · p)          # Poisson(n·p) — integer, gambly
E[output]  = n · p · 6   (full 24h / 6 ticks)    # = n · (6K / base_sell)
```

### Grind vs gamble (the breakeven)

`E[output] ⋛ n` flips at **base price = 6K**:

- **price < 6K** → expected output > seed → a reliable **grind** (the point of the
  feature: a bunch of cheap mats a little faster).
- **price > 6K** → expected output < seed → a **gamble you usually lose** (plant a
  bear paw / antler trophy, maybe hit big, usually not).

So one knob (`K`) sets where "farm" turns into "casino." `P_MAX` (~0.5) caps the
chance so the very cheapest items don't auto-multiply every unit every tick.
Start `K ≈ 0.4`; tune in `pacing_sim`. `base_sell` = the item's canonical sell
price (see Infra); no `base_sell` → unplantable.

**Show the odds.** The plant screen must surface the per-item **expected
multiplier** (`6K / base_sell`) and flag the losing ones, e.g. "Sulwood ≈ 3× —
net gain" vs "Bear Paw ≈ 0.4× — likely loss," so players gamble with eyes open.

## Cycle, the 24h cap, and harvest

- A plot **accrues every 4h** while planted, but accrual **caps at 24h** (6
  ticks). Past the cap it sits full; unharvested ticks beyond 24h are just not
  produced (no overflow, no loss of what's banked).
- Because harvest takes the output and the seed's spent, the plot is **empty**
  after harvesting. Two buttons:
  - **Harvest** — output → inventory, plot goes idle.
  - **Harvest & Replant** — output → inventory, then auto-spend `n` more of the
    same item from inventory to start the next cycle (no-op if you don't have `n`).
- Intended cadence: a **once-a-day** check — harvest (or harvest & replant) daily.

## UI

An **Orchard** page under **Enchant** in the Bench (crafting-adjacent; reorganize
later if we want), styled like the Enchant page. Per plot: what's growing, seeded
count, banked output, ticks until the 24h cap, and **Harvest / Harvest & Replant**.
Planting shows the **expected multiplier + loss warning** per item.

## Infrastructure / build order

1. **Base-price accessor** — `base_sell` lookup per item, scanning the shop
   configs (cached). One helper the service reads; `null` → unplantable.
2. **DB** — `OrchardPlot` model (`character_id`, `slot`, `item_id`, `seed_count`,
   `accrued`, `last_tick_at`) + migration. `accrued` is the banked output (the
   rolls are persisted, so the page shows the true number and harvest matches).
3. **`orchard_service.ts`** — rank→plots/capacity, plant / harvest / harvest+replant
   / clear, expected-multiplier helper, and the per-tick roll. Unit-tested.
4. **Tick (clock, not pull)** — piggyback the hourly `tickAllDue` scheduler: each
   plot rolls a tick when it's >4h due (timestamp-checked, so a restart or downtime
   just catches up on the next hourly pass), adding to `accrued` and stopping at
   the 6-tick cap. Persisting the roll is why display == harvest.
5. **API + page** — `/api/orchard` (list / plant / harvest / replant / clear) +
   the Orchard SPA page.
6. **Sim** — extend `pacing_sim` to count orchard throughput, then tune `K`.

## Open / deferred

- Exact `K` and `P_MAX` come from `pacing_sim`.
- Blacksmith's parallel layer is future work; keep the service generic enough to
  copy.
