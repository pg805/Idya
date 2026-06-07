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
- **Max roll** — the *default* cap on a single attack-action's damage field value
  at a given level. Caps how big a hit can be. A **soft** guideline, not a hard
  rule: a weapon can take an explicit exception to swing bigger if its identity
  earns it (e.g. Deck of Cards — a glass cannon that pays for oversized burst with
  paper HP). The cap keeps *most* content readable; exceptions are deliberate.

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
| Attack / offense | ~20-25% | Costed via the one-slot rule (best + 0.25·rest + crit), not a raw sum — see *Costing actions*. |
| Defend / Special | ~10-15% | Block, shield, buff/debuff — costed at capped prevention. |
| Cost / utility (Range, AOE flags, etc.) | ~10% | Once tile/movement abilities ship, these get explicit costs. |

> These percentages predate the one-slot + capped-prevention costing and need
> re-deriving — see *Re-baselining* under Open questions.

These are *guidelines, not laws*. A "tank" enemy might go 75% HP / 15% attack;
a "glass cannon" might go 30% HP / 50% attack. The budget is the constraint —
identity decides the allocation.

## Costing actions

To check a weapon/enemy against its budget, every component is priced in budget
points. HP is 1:1. Actions are priced by what they reliably deliver.

### Attack actions: expected value

An attack pays its **expected value** — the mean of its Field — times its range
and targeting multipliers. No variance discount: sim measurement (see
*Calibration* below) shows realized damage tracks EV regardless of spread,
because variance doesn't move the mean.

```
cost = EV × range_mult × aim_mult        EV = mean(Field)
```

| Factor | Rule | Values (tunable) |
|--------|------|------------------|
| `range_mult` | `1 + r·(Range − 1)`, r = 0.1 | R1 → 1.0, R2 → 1.1, R6 → 1.5 |
| `aim_mult` | reactive > 1 > aimed | reactive ×1.1, aimed ×0.9, crit ×1.0 |

- **Reactive** (`Aimed: false`) costs more — auto-resolves, reliable.
- **Aimed** (`Aimed: true`) costs less — you commit to a tile and can whiff.
  `aim_mult` should ≈ the rate aimed attacks actually land in skilled play.
- **DOT** multiplies by its duration too: `EV × range × aim × rounds`.

Dropped the earlier CV / variance discount — it under-charged swingy attacks for
damage they actually deliver (sim: Tin Punch `[…,10,10]` was charged 3.9 but
deals its full EV 5.5). See decision log.

### Crits are costed at full value

A crit (`attack_crit`) only fires when the actor Attacks while the target
Specials the same turn — tempting to discount as "conditional damage." We don't.
**Budget is planned around optimal play**, and against a known enemy pattern the
player controls when the crit lands: they read the incoming Special and time the
Attack to trigger it. A controllable tool isn't a random low-probability event,
so it pays full freight (`EV × range`, no aim, no probability multiplier). The
reverse — an enemy critting the player — requires pattern-prediction AI to
realize, which is the AI's job to earn, not the budget's to discount. Rejected a
flat `crit ×0.5`. (A non-strike crit — e.g. a crit debuff — is costed by its own
type's formula below, then added at full.)

### Defensive actions: capped prevention

A block / shield / debuff doesn't pay its face value — it pays what it actually
*prevents*, and prevention is capped at the attacker's roll (`min(value, roll)`),
not the full value. Modeling the attacker's roll as uniform around the reference
attack EV `μ` collapses that to a closed form (no expectation at calc time):

```
prevented(V) = V − V² / (4μ)          μ ≈ reference attack EV ≈ max_roll / 2

block            cost = prevented(V)
shield / debuff  cost = prevented(V) × rounds × 0.5
```

- `μ` scales with level (L1: max_roll 10 → μ ≈ 5; calibration used 4.5).
- **block ×1** — protects the same round it's cast, catches ~100% of the hit.
- **shield / debuff ×rounds×0.5** — protects *future* rounds, ~50% catch each
  (set after this round's attacks; may overlap turns the foe doesn't attack).
- Resource restore = token (~1) — enables a cycle, not a direct stat.

Plug-in table (μ = 4.5):

| V | prevented(V) = V − V²/18 |
|---|---|
| 2 | 1.78 |
| 4 | 3.11 |
| 5 | 3.61 |
| 6 | 4.00 |
| 8 | 4.44 |

Replaced the old `value × rounds`, which over-valued multi-round effects 2-3×:
the sim showed Drench `5×2` prevents ~3.7, not 10, and a shield the unit dies
before reaching prevents nothing.

### Combining actions: one slot per turn

HP is a *stock* — you hold all of it at once, so it costs 1:1. Actions are a
*flow* gated by **one action per turn**, so a kit's action cost is **not** the
sum of every action — summing would price breadth as if you could use everything
at once. Instead:

```
action_cost = best_action + 0.25 × (sum of all other actions) + Σ(crits at full)
```

- `best_action` = the single most expensive action in the kit, **any role**. You
  mostly spend your turn on your best tool, so it pays full.
- Every other action pays **0.25** — situational coverage (a backup, a different
  range/type), not additive throughput. `0.25` is the coverage knob, tunable.
- **Crits add at full, separately.** A crit isn't a turn choice — it's a rider
  that fires on top of an attack turn (crit resolves, then the main attack), so
  it's extra value, not a substitute for your slot.

Not role-bucketed: there's one slot total per turn, so only one action across the
whole kit pays full. Two cheap attacks now cost far less than one big attack —
correct, since you only act once per turn.

### From budget to level

Invert the curve to read a unit's level from its budget:

```
budget(L) = 25 · L · (L+3) / 2
L = ( −3 + √(9 + 8·budget/25) ) / 2
```

**Integer level = floor(L)**, which gives a **Level 0** for free: the whole
budget band `[0, 50)` below the first curve anchor. That's the starter / tutorial
floor — no new curve needed, it's just "everything under L1." So a unit at
budget 43 is L0, a unit at 51 is L1. The starter trio live here:

| Unit | Budget | L (continuous) | **Level** |
|------|--------|----------------|-----------|
| Tinpul | 29.3 | 0.64 | **0** |
| Branch | 41.8 | 0.87 | **0** |
| Lithkem Swallow | 43.0 | 0.88 | **0** |
| Deck of Cards | 51.0 | 1.02 | **1** |

Note the Deck is **L1, not L2** — by budget it's the same band as Branch/Swallow,
just at the top. Its L2-*looking* `[22]` burst is the glass-cannon illusion: big
numbers, paper HP, nets to L1. Power (budget) sets the tier, not the damage face.

### Worked examples (L1, μ = 4.5)

Attacks = EV × range × aim; defenses = prevented(V) [× rounds × 0.5]; combined by
the one-slot rule, then mapped to a level.

**Branch** — HP 30 + [ best Two-Handed Swing 5.10 + 0.25·(Swing 4.95 +
Pick Up 1.78) → 1.68 + Leaf Swipe crit 5.00 ] ≈ **41.8** → **L0.87**.

**Lithkem Swallow** — HP 30 + [ best Spit 4.46 + 0.25·(Peck 3.58 + Fly 3.61 +
Drench 3.61 + Swallow 0) → 2.70 + Splash crit 5.87 ] ≈ **43.0** → **L0.88**.

**Tinpul** — HP 15 + [ best Tin Punch 6.05 + 0.25·(Pea Shot 3.80 + Tin Drink 3.11
+ Harden Tin 4.44) → 2.84 + Tin Coating crit 5.42 ] ≈ **29.3** → **L0.64**.

All three are sub-L1 starter units. Tinpul is the outlier — 15 HP can't carry the
kit once the shield/crit are priced at real prevention; it needs HP or a stronger
primary to reach L1.

**Deck of Cards** (the **L1 Enchanter base weapon**) — HP 15 + [ best Spades
23.76 + 0.25·(Rank 9.65 + Ace 11.88 + Suit 17.16 + Shuffle 3.11 = 41.80) → 10.45
+ Joker crit 1.78 ] ≈ **51.0** → **L1.0**. A ranged glass cannon: oversized burst
(`[22]` Spades) on 15 HP, taking an explicit **max-roll exception**. Range is
under-credited at r=0.1, so it plays a touch above L1 once kiting matters —
accepted: against equal-or-longer range it's fine, and the fragility is the price.
(Pulled down from its old L3 label; Spellbook moves up to a higher Enchanter
level — recipe ladder re-peg TBD.)

### Calibration

The defensive constants (the `× 0.5` catch rate and the uniform-roll model behind
`prevented(V)`) and the "attacks ≈ EV" result come from
`src/tools/action_value.ts`, which runs the real resolution order (defend →
attack → special, in initiative order, with a turn-1 regain) and measures
realized damage / prevention per action. Formula vs measured, within ~2%:
Fly block 5 → 3.61 (3.68), Tin Drink 4 → 3.11 (3.01), Drench 5×2 → 3.61 (3.67).

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

- **Re-baselining after the one-slot rule.** Costing actions as `best + 0.25·rest
  + crit` rescales offense down: the Swallow baseline drops from ~51 to ~43, so a
  "full" L1 enemy now reads ~43 against a 50 cap. Decide: refill the baseline
  enemies up to the cap (more HP / stronger actions), or lower the curve's budget
  numbers to match the new scale? Either way, re-derive the allocation %s — the
  "HP 50-60% / Attack 20-25%" split was written for summed action costs.
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
- 2026-06-06: ~~Adopted **reliability-discounted attack cost** `EV / (1 + k·CV)`~~
  **— SUPERSEDED below.** Sim measurement showed realized damage tracks EV
  regardless of variance, so the CV discount under-charged swingy attacks.
- 2026-06-06: Attack **range and targeting are multipliers**, not additive:
  `range_mult = 1 + 0.1·(Range−1)`, `aim_mult` reactive ×1.1 / aimed ×0.9 /
  crit ×1.0. Multiplicative because their value scales with the attack's damage.
  Coefficients are starting values, tuned after the retune pass.
- 2026-06-06: **Crits costed at full value** (no conditional-fire discount).
  Budget is planned around optimal play; against known patterns the player
  controls crit timing, so it's a reliable tool, not a random payoff. Rejected
  flat `crit ×0.5`.
- 2026-06-06: Actions combine by the **one-slot-per-turn rule**, not a sum:
  `best_action + 0.25·(rest) + Σ(crits at full)`. HP is a stock (1:1); actions
  are a flow gated to one/turn, so breadth ≠ concurrency. Not role-bucketed —
  one slot total, so the single best action across the whole kit pays full.
  Coverage factor 0.25 is tunable.
- 2026-06-06: **Attacks costed at EV** (`EV × range × aim`), variance discount
  dropped. Sim-measured realized damage ≈ EV regardless of spread — variance
  doesn't move the mean. Replaces the CV model above.
- 2026-06-06: **Defensive actions costed at capped prevention**, not face value:
  `prevented(V) = V − V²/(4μ)`; block = prevented(V), shield/debuff =
  prevented(V) × rounds × 0.5. Derived from the `min(value, roll)` cap (uniform
  roll model) and calibrated to sim realized values (within ~2%). Replaces the
  old `value × rounds`, which over-valued multi-round effects 2-3×.
- 2026-06-06: Sim resolution **fixed to match `resolution.ts`** — action phase
  runs defend → attack → special in initiative order (1d100 − weight), with a
  **turn-1 regain** for both sides (combatants start ≥1 tile apart, so nobody
  attacks turn 1). The old per-combatant sequencing made enemy blocks worthless
  (reset before any attack), undervaluing every defensive kit.
- 2026-06-06: **Range coefficient locked at r = 0.1** (R3 → ×1.2) for now.
  Known to under-credit pure ranged kits (positioning isn't priced), but accepted:
  a ranged weapon is strong yet fine against equal-or-longer range, and it pays
  in fragility. Revisit if/when spatial value gets an explicit term.
- 2026-06-06: **Deck of Cards re-tiered L3 → L1** as the Enchanter base weapon
  (HP 25→15, Joker debuff 6→2). Lands at ~51 budget = L1.0. Takes an explicit
  **max-roll exception** (keeps its thematic `[22]` burst). Spellbook moves to a
  higher Enchanter level; recipe ladder re-peg still TBD.
