import { CombatSession } from './combat_session.js';
import { CombatIntent } from './intent.js';
import { chebyshevDist } from './board.js';
import { hasLineOfSight } from './los.js';
import { resolve_action } from './action_resolver.js';
import { SELF_TARGET_TYPES, TILE_TYPES, ActionType } from '../weapon/action.js';
import TileAction from '../weapon/action/tile_action.js';
import DestroyObstacle from '../weapon/action/destroy_obstacle.js';
import { reachableTiles, findPath } from './movement.js';

export interface ResolutionResult {
  log: string[];
  winner: string | null;
}

function pushLog(log: string[], text: string) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) log.push(trimmed);
  }
}

// N×N block of positions. Odd N centers on `center`. Even N puts `center` at the
// corner nearest the caster and sprays *away* from them (so the zone lands ahead
// of where they aimed). Callers filter out off-board / obstacle squares.
function areaBlock(center: { x: number; y: number }, area: number, caster: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (area % 2 === 1) {
    const off = (area - 1) / 2;
    for (let dx = 0; dx < area; dx++)
      for (let dy = 0; dy < area; dy++)
        out.push({ x: center.x - off + dx, y: center.y - off + dy });
  } else {
    const dirX = Math.sign(center.x - caster.x) || 1;
    const dirY = Math.sign(center.y - caster.y) || 1;
    for (let i = 0; i < area; i++)
      for (let j = 0; j < area; j++)
        out.push({ x: center.x + dirX * i, y: center.y + dirY * j });
  }
  return out;
}

// Pick a random on-board, unblocked square within `range` of `from` (excluding
// `from` itself). Used as the fallback for aimed tile drops whose intended target
// ended up out of range — better to mire a random nearby square than to drop the
// zone directly under the caster. Returns `from` only if nothing else is legal.
function randomTileInRange(
  from: { x: number; y: number },
  range: number,
  board: CombatSession['board']
): { x: number; y: number } {
  const candidates: { x: number; y: number }[] = [];
  for (let dx = -range; dx <= range; dx++)
    for (let dy = -range; dy <= range; dy++) {
      if (dx === 0 && dy === 0) continue;
      const p = { x: from.x + dx, y: from.y + dy };
      if (board.inBounds(p) && !board.isBlocked(p)) candidates.push(p);
    }
  if (candidates.length === 0) return { ...from };
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function resolveIntents(
  session: CombatSession,
  intents: Map<string, CombatIntent>,
): ResolutionResult {
  const log: string[] = [];

  const snapshot = [...session.combatants];
  const cName = (id: string) => snapshot.find(c => c.id === id)?.name ?? id;

  // --- Move phase ---
  // Tile contests resolve in two layers:
  //   1. Players always beat AI. A player and an enemy both wanting the
  //      same square hands it to the player every time, regardless of
  //      initiative — keeps aimed-attack windows under player control.
  //   2. Within the player pool (PVP / co-op later) or within the AI pool,
  //      initiative rank breaks the tie. Lower rank = sooner = wins.
  const movePriority = (id: string) => {
    const c = snapshot.find(c => c.id === id);
    if (!c) return Infinity;
    const teamRank = c.isAI ? 10_000 : 0; // any AI is greater than any player
    return teamRank + c.initiativeRank;
  };

  const byDest = new Map<string, string[]>();
  for (const [id, intent] of intents) {
    if (!intent.moveTo) continue;
    const k = `${intent.moveTo.x},${intent.moveTo.y}`;
    const group = byDest.get(k) ?? [];
    group.push(id);
    byDest.set(k, group);
  }

  const blocked = new Set<string>();

  for (const [destKey, claimants] of byDest) {
    if (claimants.length === 1) continue;
    const sortedByPriority = [...claimants].sort((a, b) => movePriority(a) - movePriority(b));
    const winner = sortedByPriority[0];
    for (const id of claimants) {
      if (id !== winner) {
        blocked.add(id);
        log.push(`${cName(id)}'s path to (${destKey}) blocked by ${cName(winner)}.`);
      }
    }
  }

  // Also block movers whose destination is occupied by a non-moving combatant
  for (const [id, intent] of intents) {
    if (!intent.moveTo || blocked.has(id)) continue;
    const dest = intent.moveTo;
    const stationaryOccupant = snapshot.find(c =>
      c.id !== id &&
      c.pos.x === dest.x && c.pos.y === dest.y &&
      !intents.get(c.id)?.moveTo
    );
    if (stationaryOccupant) blocked.add(id);
  }

  // Re-route blocked AI combatants to their next-best available tile
  const nonBlockedDests = new Set<string>();
  for (const [id, intent] of intents) {
    if (intent.moveTo && !blocked.has(id)) {
      nonBlockedDests.add(`${intent.moveTo.x},${intent.moveTo.y}`);
    }
  }

  // Re-route blocked AI combatants. We don't store the BFS path of their
  // intended move, so we approximate "stop on the path" by picking the
  // reachable tile that gets the combatant closest to the ORIGINAL
  // destination (the tile they wanted but lost). Strict-less would force
  // them to stay put any time they couldn't get strictly closer; <= lets
  // them step toward the destination even when the chebyshev distance is
  // tied (which is the case for the last tile before a blocked dest).
  for (const [id] of intents) {
    if (!blocked.has(id)) continue;
    const c = snapshot.find(c => c.id === id);
    if (!c?.isAI) continue;
    const originalDest = intents.get(id)?.moveTo;
    if (!originalDest) continue;

    const allOccupied = new Set<string>([
      ...snapshot.filter(o => o.id !== id).map(o => `${o.pos.x},${o.pos.y}`),
      ...nonBlockedDests,
    ]);

    const reachable = reachableTiles(c.pos, c.movementRange, session.board, allOccupied);

    // Pick the reachable tile that: (1) gets us closest to the original
    // destination, (2) uses the fewest steps among equally-close options.
    // Without the second tiebreak, the AI would "teleport" past blockers
    // — e.g., enemy at (6,4) blocked from (5,3) would land at (6,2) when
    // (6,3) is equally close to the goal and one step shorter.
    let bestDist = chebyshevDist(c.pos, originalDest);
    let bestStepCost = Infinity;
    let bestPos: { x: number; y: number } | null = null;
    for (const pos of reachable.values()) {
      const d = chebyshevDist(pos, originalDest);
      const stepCost = chebyshevDist(c.pos, pos);
      if (d < bestDist || (d === bestDist && stepCost < bestStepCost)) {
        bestDist = d;
        bestStepCost = stepCost;
        bestPos = pos;
      }
    }

    if (bestPos) {
      blocked.delete(id);
      intents.get(id)!.moveTo = bestPos;
      nonBlockedDests.add(`${bestPos.x},${bestPos.y}`);
    }
  }

  const moveStart = log.length;
  // Track each mover's traversed path so hazard tiles damage on every square
  // entered, not just the destination (movement isn't a teleport).
  const moverPaths = new Map<string, { x: number; y: number }[]>();
  for (const [id, intent] of intents) {
    if (!intent.moveTo || blocked.has(id)) continue;
    const c = session.combatants.find(c => c.id === id);
    if (!c) continue;
    const from = { ...c.pos };
    // Movement is a walk, not a teleport — hazards hit every square entered.
    // Route choice is a separate axis from that: the AI auto-routes around pits
    // (avoidHazards), while the player follows their previewed route, which today
    // is just the cheapest path. Letting the player pick among equal routes (and
    // thereby choose to dodge) is future work; the green-outline preview is the
    // source of truth either way, so the damage always matches what's shown.
    const path = findPath(from, intent.moveTo, c.movementRange, session.board, new Set(), c.teamId, c.isAI) ?? [intent.moveTo];
    moverPaths.set(id, path);
    c.pos = intent.moveTo;
    log.push(`${c.name} moves to (${c.pos.x},${c.pos.y})`);
  }

  // Hazard tiles: a combatant takes damage for each opposing-team hazard square
  // it enters along its path this turn. (Death is reaped during the action phase
  // below.) The square it started on doesn't re-trigger.
  for (const [id, path] of moverPaths) {
    const c = session.combatants.find(c => c.id === id);
    if (!c) continue;
    const meta = session.meta.get(c.id);
    if (!meta) continue;
    for (const step of path) {
      const tile = session.board.getTile(step);
      if (!tile || tile.kind !== 'hazard' || tile.teamId === c.teamId) continue;
      if (meta.state.health <= 0) break;
      const before = meta.state.health;
      meta.state.health = Math.max(meta.state.health - tile.value, 0);
      meta.state.damage_taken += before - meta.state.health;
      c.hp = meta.state.health;
      log.push(`${c.name} steps on a hazard at (${step.x},${step.y}): −${tile.value} HP`);
    }
  }
  if (log.length > moveStart) log.splice(moveStart, 0, '▸ Move');

  // --- Action phase ---
  // Ordered: defend → attack → special. Within each category, player(s) before AI.
  // After every individual action we sync HP, remove dead combatants, and end the
  // fight if a team is wiped. This makes "Defend beats Attack" actually true
  // (defends go up before attacks land) and matches the rock-paper-scissors the
  // tutorial teaches.

  // Resolve a single actor's intended action. Returns false if the actor's intent
  // produces no action (pass / dead / unaffordable / unresolvable).
  const runAction = (id: string): void => {
    const intent = intents.get(id);
    if (!intent || intent.action.type === 'pass') return;

    const actor = session.combatants.find(c => c.id === id);
    if (!actor) return;

    const actorMeta = session.meta.get(id);
    if (!actorMeta) return;

    if (actorMeta.state.health <= 0) return; // killed earlier this turn, can't act

    const { weapon } = actorMeta;
    let action = null;
    if (intent.action.type === 'defend')  action = weapon.defend[intent.action.actionIndex]  ?? null;
    if (intent.action.type === 'attack')  action = weapon.attack[intent.action.actionIndex]  ?? null;
    if (intent.action.type === 'special') action = weapon.special[intent.action.actionIndex] ?? null;

    if (!action) return;

    if (action.cost > 0 && action.cost > actorMeta.state.resource_current) {
      log.push(`${actor.name} cannot afford ${action.name}.`);
      return;
    }

    // --- Board-effect actions (0.2.0 positional layer) ---
    // Tile creators drop a permanent tile on the actor's own square.
    if (TILE_TYPES.has(action.type)) {
      actorMeta.state.apply_cost(action);
      const kind = action.type === ActionType.BlockTile ? 'block'
                 : action.type === ActionType.BuffTile  ? 'buff'
                 : action.type === ActionType.SlowTile  ? 'slow' : 'hazard';
      const value = (action as TileAction).value;
      // Aimed tiles (hazard/slow) land on a targeted square in range; if the
      // target ended up out of range (the AI aims at the enemy's pre-move square
      // then moves), drop on a random in-range square rather than under the caster.
      // Non-aimed tiles (pickaxe block/buff zones) drop on the caster's own square.
      // Area > 1 spreads them into an N×N block.
      let placePos = { ...actor.pos };
      const tp = intent.action.targetPos;
      if (action.aimed) {
        placePos = tp && chebyshevDist(actor.pos, tp) <= action.range
          ? { ...tp }
          : randomTileInRange(actor.pos, action.range, session.board);
      }
      // Skip off-board and obstacle squares — an intact obstacle blocks the tile.
      const cells = areaBlock(placePos, action.area, actor.pos).filter(p => session.board.inBounds(p) && !session.board.isBlocked(p));
      for (const p of cells) session.board.setTile({ pos: p, teamId: actor.teamId, kind, value });
      log.push(`${actor.name} — ${action.name}: drops ${cells.length > 1 ? `a ${action.area}×${action.area} of ${kind} tiles` : `a ${kind} tile`} at (${placePos.x},${placePos.y}).`);
      // A hazard dropped under an opposing combatant counts as entering it.
      if (kind === 'hazard') {
        for (const p of cells) {
          const victim = session.combatants.find(c => c.teamId !== actor.teamId && c.pos.x === p.x && c.pos.y === p.y);
          const vMeta = victim ? session.meta.get(victim.id) : undefined;
          if (victim && vMeta && vMeta.state.health > 0) {
            const before = vMeta.state.health;
            vMeta.state.health = Math.max(vMeta.state.health - value, 0);
            vMeta.state.damage_taken += before - vMeta.state.health;
            victim.hp = vMeta.state.health;
            log.push(`  it erupts under ${victim.name} for ${value}!  |  HP: ${before} → ${victim.hp}`);
          }
        }
      }
      return;
    }

    // Destroy Obstacle: aimed at an obstacle in range; destroy it and AOE its
    // field to enemies within 1 tile of the wreck. Resistances apply; the blast
    // bypasses block/shield.
    if (action.type === ActionType.DestroyObstacle) {
      actorMeta.state.apply_cost(action);
      const targetPos = intent.action.targetPos;
      if (!targetPos) { log.push(`${actor.name}'s ${action.name} — no target.`); return; }
      const dist = chebyshevDist(actor.pos, targetPos);
      if (dist > action.range) { log.push(`${actor.name}'s ${action.name} targeting (${targetPos.x},${targetPos.y}) — out of range (dist ${dist}).`); return; }
      if (!session.board.destroyObstacle(targetPos)) { log.push(`${actor.name}'s ${action.name} targeting (${targetPos.x},${targetPos.y}) — no obstacle there, misses.`); return; }
      const field = (action as DestroyObstacle).field;
      log.push(`${actor.name} — ${action.name}: shatters the obstacle at (${targetPos.x},${targetPos.y})!`);
      const victims = session.combatants.filter(c => c.teamId !== actor.teamId && chebyshevDist(c.pos, targetPos) <= 1);
      for (const v of victims) {
        const vMeta = session.meta.get(v.id);
        if (!vMeta || vMeta.state.health <= 0) continue;
        const mode = vMeta.state.get_roll_mode(action);
        const dmg = field.get_result_with_mode(mode);
        const before = vMeta.state.health;
        vMeta.state.health = Math.max(vMeta.state.health - dmg, 0);
        vMeta.state.damage_taken += before - vMeta.state.health;
        log.push(`  shrapnel hits ${v.name} for ${dmg}  |  HP: ${before} → ${vMeta.state.health}`);
      }
      return;
    }

    // Counters for the dev stats page. Resource-restore turns (cost < 0)
    // tell us if the weapon's resource economy is too tight; aimed-attempt
    // and aimed-hit feed the "kiting / aimed-attack hit rate" metric.
    if (action.cost < 0) actorMeta.state.restores += 1;
    const isDamagingAttack = action.type === ActionType.Strike || action.type === ActionType.DamageOverTime;
    if (action.aimed && isDamagingAttack) actorMeta.state.aimed_attempted += 1;

    if (SELF_TARGET_TYPES.has(action.type) && !action.targeted) {
      pushLog(log, resolve_action(actorMeta.state, actorMeta.state, [action]));
      return;
    }

    if (action.aimed) {
      const targetPos = intent.action.targetPos;
      if (!targetPos) return;

      const dist = chebyshevDist(actor.pos, targetPos);
      const tileStr = `(${targetPos.x},${targetPos.y})`;

      if (dist > action.range) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name} — ${action.name}: out of range (dist ${dist})${rs}`);
        return;
      }
      if (action.range > 1 && !hasLineOfSight(actor.pos, targetPos, session.board)) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name} — ${action.name}: no line of sight${rs}`);
        return;
      }

      // AOE (Area > 1): hit every enemy in the N×N around the targeted tile. Cost
      // is paid once; no per-target crit. Bypasses the empty-tile "miss" check.
      if (action.area > 1) {
        const cells = new Set(areaBlock(targetPos, action.area, actor.pos).map(p => `${p.x},${p.y}`));
        const victims = session.combatants.filter(c => c.teamId !== actor.teamId && cells.has(`${c.pos.x},${c.pos.y}`));
        if (victims.length === 0) {
          const rs = actorMeta.state.apply_cost(action);
          log.push(`${actor.name}'s ${action.name}${rs} — the ${action.area}×${action.area} at ${tileStr} catches no one.`);
          return;
        }
        const savedCost = action.cost;
        actorMeta.state.apply_cost(action);  // pay once
        action.cost = 0;
        if (isDamagingAttack) actorMeta.state.aimed_hit += 1;
        log.push(`${actor.name} — ${action.name}: ${action.area}×${action.area} blast at ${tileStr}.`);
        for (const v of victims) {
          const m = session.meta.get(v.id);
          if (!m || m.state.health <= 0) continue;
          // An obstacle between the caster and a victim shields them from the blast.
          if (!hasLineOfSight(actor.pos, v.pos, session.board)) {
            log.push(`  ${v.name} is shielded from ${action.name} by an obstacle.`);
            continue;
          }
          pushLog(log, resolve_action(actorMeta.state, m.state, [action]));
          // Crit: attacking into a victim's Special catches them mid-wind-up.
          if (intent.action.type === 'attack' && weapon.attack_crit.length > 0 &&
              intents.get(v.id)?.action.type === 'special' && m.state.health > 0) {
            actorMeta.state.attack_crits += 1;
            log.push(`★ ${actor.name} lands a critical hit on ${v.name}!`);
            pushLog(log, resolve_action(actorMeta.state, m.state, weapon.attack_crit));
          }
        }
        action.cost = savedCost;
        return;
      }

      const occupant = session.combatants.find(c => c.pos.x === targetPos.x && c.pos.y === targetPos.y);
      if (!occupant) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name} — ${action.name}: aimed at ${tileStr}, empty space${rs}`);
        return;
      }
      if (occupant.teamId === actor.teamId && action.type !== ActionType.Heal && action.type !== ActionType.Buff) {
        log.push(`${actor.name} — ${action.name}: friendly fire avoided at ${tileStr}`);
        return;
      }

      const targetMeta = session.meta.get(occupant.id);
      if (!targetMeta) return;
      if (isDamagingAttack) actorMeta.state.aimed_hit += 1;
      pushLog(log, resolve_action(actorMeta.state, targetMeta.state, [action]));
      if (intent.action.type === 'attack' && weapon.attack_crit.length > 0 &&
          intents.get(occupant.id)?.action.type === 'special') {
        actorMeta.state.attack_crits += 1;
        log.push(`★ ${actor.name} lands a critical hit!`);
        pushLog(log, resolve_action(actorMeta.state, targetMeta.state, weapon.attack_crit));
      }
    } else {
      const enemies = session.combatants.filter(c => c.teamId !== actor.teamId);
      const inRange = enemies.filter(e => chebyshevDist(actor.pos, e.pos) <= action.range);

      if (inRange.length === 0) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name} — ${action.name}: no target in range${rs}`);
        return;
      }

      const target = inRange.reduce((a, b) =>
        chebyshevDist(actor.pos, a.pos) <= chebyshevDist(actor.pos, b.pos) ? a : b
      );
      const targetMeta = session.meta.get(target.id);
      if (!targetMeta) return;
      pushLog(log, resolve_action(actorMeta.state, targetMeta.state, [action]));
      if (intent.action.type === 'attack' && weapon.attack_crit.length > 0 &&
          intents.get(target.id)?.action.type === 'special') {
        actorMeta.state.attack_crits += 1;
        log.push(`★ ${actor.name} lands a critical hit!`);
        pushLog(log, resolve_action(actorMeta.state, targetMeta.state, weapon.attack_crit));
      }
    }
  };

  // Sync HP + remove dead. Returns winner team id if a team is wiped, else null.
  const reapAndCheck = (deathKind: 'damage' | 'dot'): string | null => {
    for (const c of session.combatants) {
      const meta = session.meta.get(c.id);
      if (meta) {
        c.hp = meta.state.health;
        c.resource = meta.state.resource_current;
      }
    }
    for (const team of session.teams) {
      team.combatants = team.combatants.filter(c => {
        if (c.hp <= 0) {
          log.push(deathKind === 'dot'
            ? `${c.name} is defeated by damage over time!`
            : `${c.name} is defeated!`);
          const dyingMeta = session.meta.get(c.id);
          if (dyingMeta) session.deadCombatants.push({ combatant: c, meta: dyingMeta });
          session.meta.delete(c.id);
          return false;
        }
        return true;
      });
    }
    const alive = session.teams.filter(t => t.combatants.length > 0);
    if (alive.length < 2) return alive[0]?.id ?? null;
    return null;
  };

  // Action sub-phases: defend → attack → special. Initiative order within each
  // (lower rank = sooner). Snapshot the actor order ONCE — combatants get removed
  // mid-phase by reapAndCheck and we don't want order to shift.
  const orderedIds = [...snapshot]
    .sort((a, b) => a.initiativeRank - b.initiativeRank)
    .map(c => c.id);

  // Standing on a friendly tile grants its effect for this round, before any
  // attack lands: block tiles add to block (stacks with a defend), buff tiles
  // feed strike damage via tileBuff. Recomputed each round; cleared at end_round.
  for (const c of session.combatants) {
    const tile = session.board.getTile(c.pos);
    if (!tile || tile.teamId !== c.teamId) continue;
    const meta = session.meta.get(c.id);
    if (!meta) continue;
    if (tile.kind === 'block')     meta.state.block += tile.value;
    else if (tile.kind === 'buff') meta.state.tileBuff = tile.value;
  }

  const subPhases: Array<'defend' | 'attack' | 'special'> = ['defend', 'attack', 'special'];

  let earlyWinner: string | null = null;

  const PHASE_LABEL = { defend: '▸ Defend', attack: '▸ Attack', special: '▸ Special' };
  outer: for (const phase of subPhases) {
    const phaseStart = log.length;
    log.push(PHASE_LABEL[phase]);
    for (const id of orderedIds) {
      const intent = intents.get(id);
      if (!intent || intent.action.type !== phase) continue;
      runAction(id);
      const w = reapAndCheck('damage');
      if (w !== null) { earlyWinner = w; break outer; }
      // If only one team has combatants but the winner is still null (e.g. all
      // remaining actors are on the same team and nobody died this action),
      // reapAndCheck returns the surviving team id only when len < 2 — covered.
    }
    // Drop the header if nothing fired in this phase — keeps the log
    // visually scannable instead of dotted with empty section markers.
    if (log.length === phaseStart + 1) log.pop();
  }

  if (earlyWinner !== null || session.teams.some(t => t.combatants.length === 0)) {
    session.turn++;
    session.phase = 'ended';
    session.pendingIntents.clear();
    return { log, winner: earlyWinner };
  }

  // --- End of round: tick DOT/status sequentially in initiative order,
  // checking for death after each tick. First combatant to reach 0 ends the
  // fight for their team; later combatants' DOTs never tick.
  let winner: string | null = null;
  const dotOrder = [...session.combatants].sort((a, b) => a.initiativeRank - b.initiativeRank);
  for (const c of dotOrder) {
    const meta = session.meta.get(c.id);
    if (!meta) continue;
    const endStr = meta.state.end_round();
    c.hp = meta.state.health;
    c.resource = meta.state.resource_current;
    if (endStr) pushLog(log, endStr);

    if (c.hp <= 0) {
      const team = session.teams.find(t => t.id === c.teamId);
      if (team) team.combatants = team.combatants.filter(x => x.id !== c.id);
      const dyingMeta = session.meta.get(c.id);
      if (dyingMeta) session.deadCombatants.push({ combatant: c, meta: dyingMeta });
      session.meta.delete(c.id);
      log.push(`${c.name} is defeated by damage over time!`);
      const alive = session.teams.filter(t => t.combatants.length > 0);
      if (alive.length === 1) {
        winner = alive[0].id;
        break;
      }
    }
  }

  // --- Advance AI pattern indices ---
  for (const [, meta] of session.meta) {
    if (meta.pattern.length > 0) {
      meta.patternIndex = (meta.patternIndex + 1) % meta.pattern.length;
    }
  }

  session.turn++;
  session.phase = winner ? 'ended' : 'intent';
  session.pendingIntents.clear();

  return { log, winner };
}
