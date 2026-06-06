# 0.2.0 — Combat Scaling Overhaul

Dev-facing planning doc. Not served to players. Living document — update as
decisions land and as playtesting reshapes the curve.

The 0.2.0 release reworks how levels actually mean something. Today the
numbers drift loosely: Sulfolk (Lv 2) has 40 HP, Melbear (Lv 5) has 300 HP,
Tinpul (Lv 1) has 10 HP, and weapon damage / costs were tuned independently
without a central budget. Result: weapon vs enemy matchups are eyeballed
case-by-case, professions feel disconnected from combat, and "level" is a
soft suggestion rather than a structural constraint.

0.2.0 fixes this by anchoring weapons, enemies, professions, and upgrades to
a single budget curve.

## Scope

Three threads, in order of dependency:

1. **Scaling** (this doc). New budget curve + Rank rename. Foundation for
   everything else.
2. **Weapon and enemy identity**. Once the budget is set, each weapon/enemy
   re-tuned against it. Themes get more distinct (e.g., ranged weapons
   spend more budget on Range stats and less on raw damage).
3. **More combat abilities**. Tile- and movement-based actions (Sprint and
   the predicted-movement AI design from `battle-ideas.md` slot here).

## Vocabulary

- **Level** — the structural tier of a weapon or enemy (1–10).
- **Rank** — what we used to call "profession level." Lumberjack Rank 5,
  Blacksmith Rank 7, etc. Renamed because "level" needs to mean one thing
  now: weapon/enemy combat tier.
- **Budget** — the design-time stat-point pool for a weapon or enemy at a
  given level. Each point of HP, each unit of action value, and each unit
  of expected damage costs 1 budget point.
- **Max roll** — the cap on a single attack-action's damage field value at
  a given level. Caps how big a hit can be.

## Scale curve

**Mild quadratic on budget, linear on max roll.**

| Level | Budget | Max roll | Sample HP (60% of budget) | Same-tier hits-to-kill |
|-------|--------|----------|---------------------------|------------------------|
| 1     | 50     | 10       | 30                        | ~6                     |
| 2     | 125    | 20       | 75                        | ~7-8                   |
| 3     | 225    | 30       | 135                       | ~9                     |
| 4     | 350    | 40       | 210                       | ~10-11                 |
| 5     | 500    | 50       | 300                       | ~12                    |
| 6     | 675    | 60       | 405                       | ~13-14                 |
| 7     | 875    | 70       | 525                       | ~15                    |
| 8     | 1,100  | 80       | 660                       | ~16-17                 |
| 9     | 1,350  | 90       | 810                       | ~18                    |
| 10    | 1,625  | 100      | 975                       | ~19-20                 |

**Closed form**:

- `budget(L) = 25 × L × (L+3) / 2`
- `max_roll(L) = 10 × L`
- Budget step grows by `+25` each level (75 → 100 → 125 → …).

### Implications

- **Same-tier fights pace by level.** L1 = ~6 hits. L10 = ~20 hits. Higher-tier
  fights feel meatier and more strategic by design; low-tier farms stay snappy.
  Accepted as a feature, not a bug.
- **Cross-tier behaves like a soft wall.** L5 weapon vs L1 enemy: 1-2 hits.
  L1 weapon vs L10 enemy: ~200 hits — effectively impossible. The interesting
  band is ±2-3 tiers.
- **Numbers stay readable.** L10 max roll = 100, HP ≈ 1,000. No `1.2k` UI
  shorthand needed.
- **Mild quadratic over geometric ×5**: chosen because ×5 was a hard wall
  (cross-tier mathematically impossible) and pure linear felt too flat for
  the progression we want.

## Budget allocation guideline

Per weapon / enemy at level L:

| Bucket | % of budget | Notes |
|--------|-------------|-------|
| HP | ~50-60% | Defines durability. Tunable per identity (tank vs glass cannon). |
| Attack EV (sum across actions) | ~20-25% | Sum of expected values × frequency weights. |
| Defend / Special action values | ~10-15% | Block, shield, buff/debuff strengths. |
| Cost / utility (Range, AOE flags, etc.) | ~10% | Once tile/movement abilities ship, these get explicit costs. |

These are *guidelines, not laws*. A "tank" enemy might go 75% HP / 15% attack;
a "glass cannon" might go 30% HP / 50% attack. The budget is the constraint —
identity decides the allocation.

## Rank ↔ Level mapping

**1:1 across 10 levels.**

| Profession Rank | Weapon / enemy Level | What unlocks |
|-----------------|----------------------|--------------|
| 1 | L1 | Base weapons, first recipe |
| 2 | L1 | (smelt unlock, etc.) |
| 3 | L2 | Tier-2 materials, refined weapons |
| 4 | L2 | Upgrade budget begins |
| 5 | L3 | Mid-tier crafts |
| 6 | L3 | More budget |
| 7 | L4 | Tier-3 materials, advanced crafts |
| 8 | L4 | More budget |
| 9 | L5 | Endgame crafts begin |
| 10 | L5 | Final budget cap |

Loose rather than strict — Rank 1 and 2 both produce L1 stuff, Rank 9 and 10
both top out at L5. The exact unlock schedule shakes out once the recipe
ladder is re-pegged to the new curve.

> TBD whether we expand enemies/weapons to 10 distinct combat levels or keep
> the roster at 5 with finer rank gates between them. Current lean: 5 combat
> levels covered by 10 ranks, since 10 distinct combat tiers is a lot of
> content to balance.

## Upgrade system (TBD)

Working numbers from the discussion, not yet locked:

- ~+3 to ~+4 budget per Rank starting somewhere around Rank 4 → ~21-28
  cumulative budget headroom by Rank 10.
- ~+10 budget per upgrade applied to a weapon → on the order of 2-3 upgrades
  for a fully-Ranked profession.
- A fully-upgraded L1 weapon should be competitive at L2, but not L3.
  Cross-tier upgrade-pushing is bounded.

Settle these after the weapon re-tuning pass — we'll know what "+10 budget"
actually buys in the new currency by then.

## Open questions

- **Roll mode at high level.** Crit and weakness rolls currently produce a
  4-dice-take-highest result. With max roll = 100 at L10, a `[0, 25, 50, 75,
  100]` Field gives Hd4 results clustered near 100 — does the variance still
  feel right at scale? Worth eyeballing during the L5 → L10 retune.
- **Existing players' weapons + Rank.** Migration policy: clamp existing
  upgrades to new budget, refund excess as materials? Reset upgrades and
  let players re-spec? Decide before shipping.
- **Tutorial enemy at the new curve.** Tutorial swallow is currently a
  bespoke L1 enemy with fixed pattern + low damage. Likely stays bespoke
  rather than auto-fitting the curve, since the goal is *teach mechanics*
  not *fight a balanced foe*.

## Where this overlaps with parked work

`docs/battle-ideas.md` has the Sprint design (4th universal action slot,
+2 movement, no resource cost) and the predicted-movement AI (optimal-kite
formula). Both belong in 0.2.x, sequenced *after* the scaling rebuild —
they assume the new budget exists so we can cost the new abilities.

---

### Decision log

- 2026-06-06: Picked **mild quadratic** over geometric ×5 (too explosive)
  and pure linear (too flat).
- 2026-06-06: Renamed "profession level" → **Rank**. "Mastery" considered
  and dropped — "Rank" reads as progression, "Mastery" reads as endpoint.
- 2026-06-06: **1:1 rank-to-level mapping** anchored to 10 of each, though
  the question of "5 distinct combat tiers covered by 10 ranks vs. 10
  distinct combat tiers" is still open.
