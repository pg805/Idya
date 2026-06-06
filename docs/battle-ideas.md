# Idya — Design Ideas & Future Work

Decisions locked into the current build are in CLAUDE.md. This file is for things we want to do but aren't building yet.

---

## AI Behavior

Current AI: greedy chase via BFS (closest reachable tile to nearest enemy) + pattern-based action selection with skip-if-unaffordable. Telegraph reads the same affordability-walked entry as of 0.1.5+, so the player sees what the AI will actually do.

Observed gaps from playtesting (0.1.5 prod data):
- Range-1 melee enemies essentially never land hits on a player with range > 1 — movement parity means a kiting player maintains distance forever.
- Aimed attacks miss against any moving player — the AI commits to the player's current tile, player moves off it.
- Net effect: combat is a *navigation puzzle*, not a *fight*. Fine for L1-L3 farm content, shallow for endgame.

### Sprint (locked design, not yet built)

A 4th action slot alongside Defend / Attack / Special. Universal — every weapon has it.

- **+2 movement** that turn (so player moves 4 tiles total instead of 2).
- **No resource cost**. The trade-off is your action slot.
- **For AI**: pattern-includable. Designer puts `Sprint` in a pattern at strategic closing points; AI runs it like any other action.

Player Sprint = harder to land aimed attacks against. Enemy Sprint = melee enemy can finally close on a kiter. Symmetric counter-system.

UI: 4th button next to Defend/Attack/Special. Action type id: TBD (currently 1=Strike, 2=Block, 3=Buff, 4=DOT, 5=Debuff, 6=Heal, 7=Reflect, 8=Shield — Sprint would be 9 or a separate movement-modifier flag).

### Predicted-movement AI (design locked, not yet built)

Goal: make AI movement and aimed-attack targeting based on where the player will *probably be next turn*, not where they *currently are*. Deterministic — random sampling was rejected because it loses skill expression. A predictable heuristic is something the player can read and play against, which creates depth.

**Algorithm: Optimal-kite prediction.** The AI models the player as wanting to be at their preferred attack range.

```
predict(player, ai):
  playerIdealRange = max(action.range for action in player.attacks)
  d = chebyshev(player.pos, ai.pos)
  if d == playerIdealRange:        // at ideal range → player stays
    return player.pos
  if d > playerIdealRange:         // too far → player closes
    direction = toward(ai)
  else:                            // too close → player retreats
    direction = away(ai)
  return clampToBoard(player.pos + direction * player.movementRange)
```

The predicted position then feeds:
- **Aimed attacks**: target the predicted tile instead of current.
- **AI movement**: AI picks a reachable tile that maximizes "in range of predicted position next turn" rather than "closest to player's current position."

**Counter for players:** play sub-optimally on purpose. AI predicts retreat → close instead. AI predicts stay → move. This is exactly the skill-expression vector the random-sample approach lacked.

**Upgrade path** (call it the *hybrid* algorithm — later release):

```
predict(player, ai, history):
  expected = optimalKite(player, ai)
  if history.lastPlayerMove and player.pos != expected_prev_turn:
    return clampToBoard(player.pos + history.lastPlayerMove)  // extrapolate
  return expected
```

Tracks the player's last move. If the player broke the kite model last turn, switch to extrapolation. Catches both "too predictable" and "playing-against-the-AI" patterns.

### Why bother

Sprint + predicted movement together make L4+ enemies feel like opponents, not patterns. Sulfolk / Melbear / Golnosar can have meaningful Sprint placements + predicted aim; lower-tier enemies (Maetoad, Daefen Deer) can stay greedy to preserve farming viability. AI character emerges from pattern *and* movement design, not just attack rotation.

### Other depth mechanics (parked further out)

- **AOE actions**: Strike that hits a 3×3 instead of a tile. Standing still becomes safer; clustering punishes. Changes the math entirely.
- **Persistent ground effects**: drop a tar pool / poison cloud that lingers for N rounds. Adds positional commitment.
- **LOS-aware AI positioning**: AI uses obstacles for cover; breaks LOS to bait aimed attacks into walls.
- **Threat-aware retreat**: when AI is at low HP, prefer tiles farther from the enemy to buy time for heal.

---

## Combat System — Future Ideas

- **Movement range as a weapon/character stat** (currently hardcoded to 2 for everyone). Likely derived from `Weight` — heavier = slower — but feels backwards for "ranged should kite". Sprint may be the better solution.
- **Obstacle interaction**: attack to damage/destroy, push, use as cover modifier.
- **Corner-peeking LoS rules**: define whether adjacent diagonal obstacles block.
- **Fog of war** for team-vs-team.
- **Procedural board generation by biome**: tight corridors for sewers/dungeons, scattered cover for forests, open ground for plains — current generation is uniform random regardless of context.
- **Destructible environment tiles** that change board state mid-fight.
- **Elevation tiles** (high ground = range bonus, low ground = penalty).
- **Knockback actions** that change combatant position on hit.

---

## Multiplayer

- PvP 1v1: same session model, Team B combatants are human-controlled.
- Team vs team: N combatants per side, resolve all intents simultaneously.
- Spectator mode: read-only socket connection to a session.

---

## Weapons & Actions

- Per-weapon movement stat (currently hardcoded 2 for everyone).
- Per-action range tiers (melee 0-1, mid 2-3, ranged 4+) as a design concept for action design.
- Area-of-effect actions (hit a tile + adjacent tiles).

---

## Board & UI

- Canvas renderer for animation: movement trails, impact effects, status indicators.
- Minimap or replay viewer for post-battle review.
- **Environment color schemes** — swap CSS variables per board theme:
  - Sewer/Underground: muted greens, damp stone browns, dark water blue
  - Forest: deep greens, earth tones, filtered light amber
  - Dungeon: cold stone gray, torch orange accents, ominous deep red
  - Desert ruins: bleached beige, harsh yellow, crumbling sandstone
  - Volcanic: char black, lava orange, ash gray
  - Tundra: ice blue, stark white, frozen steel gray
  - Ancient ruins: faded purple, crumbling stone, tarnished gold

---

## Meta / Long-term

- Location system: different maps/biomes with unique board templates.
- Player progression: stats, gear, unlockable weapons.
- Ranked PvP matchmaking via Discord.
- Spectator betting (currency wagered on match outcomes).

---

## Open Design Questions

- **Defend Crit / Special Crit**: triggers undefined. Currently neither fires for any weapon. Mirror the Attack Crit "vs. matching opposing action" rule, or different?
- **Partial rewards on loss**: losing currently gives nothing. Consolation drop, partial korel, or stay at zero?
- **NPC pattern start position**: now randomized per spawn (0.1.5). Should pattern advancement on skipped actions advance to the *fired* index + 1, or stay at the current "blind +1" rule? (See Lithkem Swallow turn 7-8 in Flint's battle log — Swallow fired twice in a row because pattern indexed past Spit but only advanced +1.)
