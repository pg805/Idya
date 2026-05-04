import { CombatSession } from './combat_session.js';
import { CombatIntent } from './intent.js';
import { chebyshevDist } from './board.js';
import { hasLineOfSight } from './los.js';
import { resolve_action } from './action_resolver.js';
import { SELF_TARGET_TYPES } from '../weapon/action.js';
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
  const movePriority = (id: string) => (snapshot.find(c => c.id === id)?.isAI ? 2 : 1);

  const byDest = new Map<string, string[]>();
  for (const [id, intent] of intents) {
    if (!intent.moveTo) continue;
    const k = `${intent.moveTo.x},${intent.moveTo.y}`;
    const group = byDest.get(k) ?? [];
    group.push(id);
    byDest.set(k, group);
  }

  const blocked = new Set<string>();

  for (const [, claimants] of byDest) {
    if (claimants.length === 1) continue;
    const bestPriority = Math.min(...claimants.map(movePriority));
    const winners = claimants.filter(id => movePriority(id) === bestPriority);
    if (winners.length === 1) {
      for (const id of claimants) {
        if (id !== winners[0]) {
          blocked.add(id);
          log.push(`${cName(id)} yields to ${cName(winners[0])}.`);
        }
      }
    } else {
      for (const id of claimants) blocked.add(id);
      log.push(`${winners.map(cName).join(' and ')} tie for the same tile — neither moves.`);
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

  for (const [id] of intents) {
    if (!blocked.has(id)) continue;
    const c = snapshot.find(c => c.id === id);
    if (!c?.isAI) continue;

    const allOccupied = new Set<string>([
      ...snapshot.filter(o => o.id !== id).map(o => `${o.pos.x},${o.pos.y}`),
      ...nonBlockedDests,
    ]);

    const reachable = reachableTiles(c.pos, c.movementRange, session.board, allOccupied);

    const enemies = snapshot.filter(e => e.teamId !== c.teamId);
    if (enemies.length === 0) continue;
    const target = enemies.reduce((a, b) =>
      chebyshevDist(c.pos, a.pos) <= chebyshevDist(c.pos, b.pos) ? a : b
    );

    let bestDist = chebyshevDist(c.pos, target.pos);
    let bestPos: { x: number; y: number } | null = null;
    for (const pos of reachable.values()) {
      const d = chebyshevDist(pos, target.pos);
      if (d < bestDist) { bestDist = d; bestPos = pos; }
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

  // --- Action phase ---
  for (const [id, intent] of intents) {
    if (intent.action.type === 'pass') continue;

    const actor = session.combatants.find(c => c.id === id);
    if (!actor) continue;

    const actorMeta = session.meta.get(id);
    if (!actorMeta) continue;

    if (actorMeta.state.health <= 0) continue; // killed earlier this turn, can't act

    const { weapon } = actorMeta;
    let action = null;
    if (intent.action.type === 'defend')  action = weapon.defend[intent.action.actionIndex]  ?? null;
    if (intent.action.type === 'attack')  action = weapon.attack[intent.action.actionIndex]  ?? null;
    if (intent.action.type === 'special') action = weapon.special[intent.action.actionIndex] ?? null;

    if (!action) continue;

    if (SELF_TARGET_TYPES.has(action.type)) {
      pushLog(log, resolve_action(actorMeta.state, actorMeta.state, [action]));
      continue;
    }

    if (action.aimed) {
      // Aimed: hits the committed tile — target can dodge by moving off it
      const targetPos = intent.action.targetPos;
      if (!targetPos) continue;

      const dist = chebyshevDist(actor.pos, targetPos);
      const tileStr = `(${targetPos.x},${targetPos.y})`;

      if (dist > action.range) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name}'s ${action.name}${rs} targeting ${tileStr} — out of range (dist ${dist}).`);
        continue;
      }
      if (action.range > 1 && !hasLineOfSight(actor.pos, targetPos, session.board)) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name}'s ${action.name}${rs} targeting ${tileStr} — no line of sight.`);
        continue;
      }

      const occupant = session.combatants.find(c => c.pos.x === targetPos.x && c.pos.y === targetPos.y);
      if (!occupant) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name}'s ${action.name}${rs} targeting ${tileStr} — commits to empty space, misses.`);
        continue;
      }
      if (occupant.teamId === actor.teamId) {
        log.push(`${actor.name}'s ${action.name} targeting ${tileStr} — friendly fire avoided.`);
        continue;
      }

      const targetMeta = session.meta.get(occupant.id);
      if (!targetMeta) continue;
      pushLog(log, resolve_action(actorMeta.state, targetMeta.state, [action]));
      if (intent.action.type === 'attack' && weapon.attack_crit.length > 0 &&
          intents.get(occupant.id)?.action.type === 'special') {
        log.push(`★ ${actor.name} lands a critical hit!`);
        pushLog(log, resolve_action(actorMeta.state, targetMeta.state, weapon.attack_crit));
      }
    } else {
      // Reactive: auto-targets the nearest enemy in range after all moves
      const enemies = session.combatants.filter(c => c.teamId !== actor.teamId);
      const inRange = enemies.filter(e => chebyshevDist(actor.pos, e.pos) <= action.range);

      if (inRange.length === 0) {
        const rs = actorMeta.state.apply_cost(action);
        log.push(`${actor.name}'s ${action.name}${rs} — no target in range.`);
        continue;
      }

      const target = inRange.reduce((a, b) =>
        chebyshevDist(actor.pos, a.pos) <= chebyshevDist(actor.pos, b.pos) ? a : b
      );
      const targetMeta = session.meta.get(target.id);
      if (!targetMeta) continue;
      pushLog(log, resolve_action(actorMeta.state, targetMeta.state, [action]));
      if (intent.action.type === 'attack' && weapon.attack_crit.length > 0 &&
          intents.get(target.id)?.action.type === 'special') {
        log.push(`★ ${actor.name} lands a critical hit!`);
        pushLog(log, resolve_action(actorMeta.state, targetMeta.state, weapon.attack_crit));
      }
    }
  }

  // --- Sync state → combatant ---
  for (const c of session.combatants) {
    const meta = session.meta.get(c.id);
    if (meta) {
      c.hp = meta.state.health;
      c.resource = meta.state.resource_current;
    }
  }

  // --- Remove combatants killed by direct damage ---
  for (const team of session.teams) {
    team.combatants = team.combatants.filter(c => {
      if (c.hp <= 0) {
        log.push(`${c.name} is defeated!`);
        session.meta.delete(c.id);
        return false;
      }
      return true;
    });
  }

  // --- End of round: tick DOT and status effects ---
  for (const c of session.combatants) {
    const meta = session.meta.get(c.id);
    if (!meta) continue;
    const endStr = meta.state.end_round();
    c.hp = meta.state.health;
    c.resource = meta.state.resource_current;
    if (endStr) pushLog(log, endStr);
  }

  // --- Remove combatants that died to DOT ---
  for (const team of session.teams) {
    team.combatants = team.combatants.filter(c => {
      if (c.hp <= 0) {
        log.push(`${c.name} is defeated by damage over time!`);
        session.meta.delete(c.id);
        return false;
      }
      return true;
    });
  }

  // --- Advance AI pattern indices (only when the action wasn't skipped) ---
  for (const [id, meta] of session.meta) {
    if (meta.pattern.length === 0) continue;
    const intent = intents.get(id);
    if (intent && intent.action.type === 'pass') continue;
    meta.patternIndex = (meta.patternIndex + 1) % meta.pattern.length;
  }

  // --- Check win condition ---
  const aliveTeams = session.teams.filter(t => t.combatants.length > 0);
  const winner = aliveTeams.length === 1 ? aliveTeams[0].id : null;

  session.turn++;
  session.phase = winner ? 'ended' : 'intent';
  session.pendingIntents.clear();

  return { log, winner };
}
