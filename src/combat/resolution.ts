import { CombatSession } from './combat_session.js';
import { CombatIntent } from './intent.js';
import { chebyshevDist } from './board.js';
import { hasLineOfSight } from './los.js';
import { resolve_action } from './action_resolver.js';
import { SELF_TARGET_TYPES, TILE_TYPES, ActionType } from '../weapon/action.js';
import TileAction from '../weapon/action/tile_action.js';
import DestroyObstacle from '../weapon/action/destroy_obstacle.js';
import { reachableTiles } from './movement.js';

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

  for (const [id, intent] of intents) {
    if (!intent.moveTo || blocked.has(id)) continue;
    const c = session.combatants.find(c => c.id === id);
    if (!c) continue;
    const old = c.pos;
    c.pos = intent.moveTo;
    log.push(`${c.name} moves (${old.x},${old.y}) → (${c.pos.x},${c.pos.y}).`);
  }

  // Hazard tiles: a combatant that moved onto an opposing team's hazard tile
  // takes its damage on entry. (Death is reaped during the action phase below.)
  for (const [id, intent] of intents) {
    if (!intent.moveTo || blocked.has(id)) continue;
    const c = session.combatants.find(c => c.id === id);
    if (!c) continue;
    const tile = session.board.getTile(c.pos);
    if (!tile || tile.kind !== 'hazard' || tile.teamId === c.teamId) continue;
    const meta = session.meta.get(c.id);
    if (!meta) continue;
    const before = meta.state.health;
    meta.state.health = Math.max(meta.state.health - tile.value, 0);
    meta.state.damage_taken += before - meta.state.health;
    c.hp = meta.state.health;
    log.push(`${c.name} steps onto a hazard tile and takes ${tile.value}!  |  HP: ${before} → ${c.hp}`);
  }

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
                 : action.type === ActionType.BuffTile  ? 'buff' : 'hazard';
      session.board.setTile({ pos: { ...actor.pos }, teamId: actor.teamId, kind, value: (action as TileAction).value });
      log.push(`${actor.name} — ${action.name}: drops a ${kind} tile at (${actor.pos.x},${actor.pos.y}).`);
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
        log.push(`${actor.name}'s ${action.name}${rs} targeting ${tileStr} — out of range (dist ${dist}).`);
        return;
      }
      if (action.range > 1 && !hasLineOfSight(actor.pos, targetPos, session.board)) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name}'s ${action.name}${rs} targeting ${tileStr} — no line of sight.`);
        return;
      }

      const occupant = session.combatants.find(c => c.pos.x === targetPos.x && c.pos.y === targetPos.y);
      if (!occupant) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name}'s ${action.name}${rs} targeting ${tileStr} — commits to empty space, misses.`);
        return;
      }
      if (occupant.teamId === actor.teamId && action.type !== ActionType.Heal && action.type !== ActionType.Buff) {
        log.push(`${actor.name}'s ${action.name} targeting ${tileStr} — friendly fire avoided.`);
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
        log.push(`${actor.name}'s ${action.name}${rs} — no target in range.`);
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

  outer: for (const phase of subPhases) {
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
