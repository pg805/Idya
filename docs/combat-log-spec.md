# Combat Log Spec

The combat log is a flat list of lines streamed per turn (`turn_result({log})`).
Each line is **classified** into one category that drives both its CSS styling and
the player's filter checkboxes. The goal: **maximum information, minimum symbols,
legible at a glance** — the same shape every time so the eye learns it once.

Dev-facing. Producers: `src/combat/resolution.ts` (phases, moves, AOE) and
`src/combat/action_resolver.ts` (per-action blocks). Consumer: `public/game.js`
(`classifyLogLine` / `renderLogLine`).

## Line categories

| Category | Looks like | Notes |
|---|---|---|
| `turn-divider` | `━━━ Turn N ━━━` | always shown |
| `phase-header` | `▸ Move` / `▸ Defend` / `▸ Attack` / `▸ Special` | sub-phase markers |
| `move` | `⚡<init> <name> <square>[ → <square>…][ ✗ <denied>]` | positions: initiative list + movement |
| `crit` | `★ <attacker> counters <target>!` | triangle-crit announcement |
| `status` | `<unit> is defeated!`, effect expirations | |
| `flavor` | prose, italic + dim | leads each action block; tagged with U+200B |
| `action` (`action-head`) | `<actor> — <action>[ → <target>][: <result>]` | the glance line |
| `resolve` (`mechanics`) | 4-space-indented derivation | full mechanics |

Classification is by leading marker / shape, in priority order (see
`classifyLogLine`): U+200B → flavor; `━━━` → divider; `▸` → phase; `★` → crit;
`is defeated` → status; contains `⚡N` → move; leading whitespace → resolve;
contains ` — ` → action; else flavor. Flavor is U+200B-tagged precisely because
the prose often contains an em-dash and would otherwise look like an action line.

### Detail dial

The player picks a detail level — one dial, three stops — rather than toggling
each category (16 combinations, most nonsense). Action lines are always on:

| Preset | Shows | For |
|---|---|---|
| **Minimal** | action only | the barest skeleton — who did what |
| **Standard** (default) | + resolve + moves | the full play-by-play, math and positions |
| **Story** | + flavor | narration on |

Resolve is **on by default** (Standard) — so costs, reflect, knockback and the
roll math are visible without opting in; Minimal is the one place they're hidden.
Drives the `hide-flavor` / `hide-mechanics` / `hide-move` classes on `#combat-log`
(`LOG_PRESETS` in `game.js`). The positional phase headers `▸ Move` / `▸ Initiative`
are classed as `move`, so they hide with their roster in Minimal; the action-phase
headers `▸ Defend` / `▸ Attack` / `▸ Special` always show as orientation.

## The action block

Every resolved action renders as three stacked tiers — story, then headline, then
the math:

```
<flavor>                                        ← Flavor  (italic, leads the block)
<actor> — <action>[ → <target>][: <result>]     ← Action  (the glance line)
    <resolve line>                               ← Resolve (indented, off by default)
    …
```

Because **Resolve is hidden by default** (Standard/Story), the action line must
carry the headline value on its own. The resolve stack is then the **full
derivation and nothing redundant** — only what you can't read off the action
line. A flat effect (block/shield/buff/…) *is* its number, so it gets no echo,
just its cost; a rolled effect (strike/DOT) shows the dice → modifiers → `Total`
that produced it.

### Action-line `<result>` — the glance value

| Action | Action line | Resolve stack |
|---|---|---|
| Strike | `: <dmg>` | mode? · dice · modifiers · cost · `Total <dmg>` |
| DOT | `: <dmg> per turn · <R> turns` | mode? · dice · cost · `Total <dmg> per turn · <R> turns` |
| Block | `: Block <N>` | cost · `Total <running>` *(only if stacked)* |
| Shield | `: Shield <N> · <R> turns` | cost |
| Reflect | `: Reflect <N> · <R> turns` | cost |
| Buff | `: Buff <N> · <R> turns` | cost |
| Debuff | `: Debuff <N> · <R> turns` | cost |
| Slow (move debuff) | `: Slow <N> · <R> turns` | cost |
| Heal | `: Heal <N>` | cost |
| **Restore** (value-0 block) | *(blank)* | the regain `+<N> <resource>` |

Notes:
- **No flat echo.** A flat effect's resolve is just its cost (often nothing on a
  free crit). The value lives only on the action line.
- **Stacked block** is the exception that proves the rule: a 2nd guard the same
  turn (a defend-crit on top of the main block) adds a `Total <running>` resolve
  line — `4` then `Block 3` → `Total 7` — because the running total is a real
  derivation you can't read off `Block 3`. A first/only block has none.
- **Restores** are the other special case: blank action line (value is 0), with
  the regain (`+7 Flow`) as the resolve line — their only effect is the resource.
  The delta is the *actual* gain (capped at max).
- **Overwrites are silent.** A 2nd DOT replaces the first; a buff clears a debuff
  (and vice-versa); a re-applied shield/reflect refreshes its rounds. The log just
  shows the new state — no "X was overwritten" line.

### Resolve-stack lines

- **mode header** (only on weakness/resist): `Resist (take lowest)` /
  `Weakness (take highest)`.
- **dice**: the full field once per die, the rolled face **bolded**
  (`[25, 33, **33**, …]`); a multi-die mode prints one line per die.
- **modifiers** (strikes): `− block N`, `− shield N`, `+ buff N`, `+ tile N`,
  `− debuff N` — only when nonzero.
- **cost**: `−<N> <resource>` (spend) / `+<N> <resource>` (regain), once.
- **Total**: the final value, last. Strikes/DOTs only (flat effects don't derive).
- **reflect**: `↺ <N> reflected to <actor>`.

### AOE strikes (one block, e.g. Riptide)

An area strike is a **single** block, not a per-victim repeat:

```
<flavor>
<actor> — <action>: <A>×<A> blast at (x,y)
    blink to (x,y)            ← if MoveTo
    [ vs <victim>: ]          ← only when >1 victim
    <mode? · dice · mods · Total>   ← per victim
    …
    −<N> <resource>           ← shared cost, paid once, at the foot
```

The action line names the area (not a single damage value — victims differ); each
victim's roll + `Total` lives in the resolve stack. DOT/debuff areas keep a
generic per-victim path (their resolution differs from a strike's).

## Movement

One consistent shape, but **only for units that actually moved or were denied a
square** — a unit holding its position says nothing and is dropped (the whole
`▸ Move` block is omitted when no one moved).

```
⚡<init> <name> <from>[ → <step>…][ ✗ <denied>]
```

- `⚡<init>` first (initiative also orders the lines — no separate rank number).
- the full traversed path, square by square.
- a unit denied a square appends `✗ (denied)`: a partial re-route reads
  `(from) → (mid) ✗ (dest)`, a full block `(from) ✗ (dest)`. There is no separate
  "blocked by" line.

The battle-start initiative list is its own positional block — a `▸ Initiative`
header (a `move`-classed phase header, not prose) over the roster in the same
`⚡<init> <name> (square)` shape, every unit:

```
▸ Initiative
⚡99 Lithkem Swallow (3,1)
⚡82 Player (1,1)
```

## Misses / fizzles

A wasted action (no target, out of range, no LOS, empty tile, friendly fire) reads
in the same action shape, cost on its own resolve line:

```
<actor> — <action>: <reason>
    −<N> <resource>
```

(Routed through `logMiss` in `resolution.ts` so there's a single source of truth.)
