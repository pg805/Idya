# Combat Log Spec

The combat log is a flat list of lines streamed per turn (`turn_result({log})`).
Each line is **classified** into one category that drives both its CSS styling and
the player's filter checkboxes. The goal: **maximum information, minimum symbols,
legible at a glance** — the same shape every time so the eye learns it once.

Dev-facing. Producers: `src/combat/resolution.ts` (phases, moves, AOE) and
`src/combat/action_resolver.ts` (per-action blocks). Consumer: `public/game.js`
(`classifyLogLine` / `renderLogLine`).

## Line categories

| Category | Looks like | Toggle | Notes |
|---|---|---|---|
| `turn-divider` | `━━━ Turn N ━━━` | — | always shown |
| `phase-header` | `▸ Move` / `▸ Defend` / `▸ Attack` / `▸ Special` | — | sub-phase markers |
| `move` | `⚡<init> <name> <square>[ → <square>…][ ✗ <denied>]` | **Moves** | positions: initiative list + movement |
| `crit` | `★ <attacker> counters <target>!` | — | triangle-crit announcement |
| `status` | `<unit> is defeated!`, effect expirations | — | |
| `flavor` | prose, italic + dim | **Flavor** | leads each action block; tagged with U+200B |
| `action` (`action-head`) | `<actor> — <action>[ → <target>][: <result>]` | **Actions** | the glance line |
| `resolve` (`mechanics`) | 4-space-indented derivation | **Resolve** | full mechanics; **off by default** |

Classification is by leading marker / shape, in priority order (see
`classifyLogLine`): U+200B → flavor; `━━━` → divider; `▸` → phase; `★` → crit;
`is defeated` → status; contains `⚡N` → move; leading whitespace → resolve;
contains ` — ` → action; else flavor. Flavor is U+200B-tagged precisely because
the prose often contains an em-dash and would otherwise look like an action line.

## The action block

Every resolved action renders as three stacked tiers — story, then headline, then
the math:

```
<flavor>                                        ← Flavor  (italic, leads the block)
<actor> — <action>[ → <target>][: <result>]     ← Action  (the glance line)
    <resolve line>                               ← Resolve (indented, off by default)
    …
```

Because **Resolve is hidden by default**, the action line must carry the headline
value on its own. The resolve stack then repeats it inside the full derivation —
that duplication is intentional: the action line is the summary, the resolve stack
is the complete, self-contained story (and ends in `Total`).

### Action-line `<result>` — the glance value

| Action | Action line | Resolve stack |
|---|---|---|
| Strike | `: <dmg>` | mode? · dice · modifiers · cost · `Total <dmg>` |
| DOT | `: <dmg> per turn · <R> turns` | mode? · dice · cost · `Total <dmg> per turn · <R> turns` |
| Block | `: Block <N>` | `block <N>` · cost |
| Shield | `: Shield <N> · <R> turns` | `shield <N> · <R> turns` · cost |
| Reflect | `: Reflect <N> · <R> turns` | `reflect <N> · <R> turns` · cost |
| Buff | `: Buff <N> · <R> turns` | `buff <N> · <R> turns` · cost |
| Debuff | `: Debuff <N> · <R> turns` | `debuff <N> · <R> turns` · cost |
| Slow (move debuff) | `: Slow <N> · <R> turns` | `slow <N> · <R> turns` · cost |
| Heal | `: Heal <N>` | `heal <N>` · cost |
| **Restore** (value-0 block) | *(blank)* | the regain `+<N> <resource>` |

**Restores are the one exception**: their only effect is the resource they return,
so the action line is blank and the gain (`+7 Flow`) shows as a resolve line.
The resource delta is the *actual* gain (capped at max) — full value when you have
room for it.

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

One consistent shape for every unit, holders included:

```
⚡<init> <name> <from>[ → <step>…][ ✗ <denied>]
```

- `⚡<init>` first (initiative also orders the lines — no separate rank number).
- the full traversed path, square by square.
- a unit denied a square appends `✗ (denied)`: a partial re-route reads
  `(from) → (mid) ✗ (dest)`, a full block `(from) ✗ (dest)`. There is no separate
  "blocked by" line.

The battle-start initiative list uses the same `⚡<init> <name> (square)` shape.

## Misses / fizzles

A wasted action (no target, out of range, no LOS, empty tile, friendly fire) reads
in the same action shape, cost on its own resolve line:

```
<actor> — <action>: <reason>
    −<N> <resource>
```

(Routed through `logMiss` in `resolution.ts` so there's a single source of truth.)
