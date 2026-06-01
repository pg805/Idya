import { CombatSession } from './combat_session.js';
import { CombatIntent } from './intent.js';
import { chebyshevDist } from './board.js';
import { hasLineOfSight } from './los.js';
import { resolve_action } from './action_resolver.js';
import { SELF_TARGET_TYPES, ActionType } from '../weapon/action.js';
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
      pushLog(log, resolve_action(actorMeta.state, targetMeta.state, [action]));
      if (intent.action.type === 'attack' && weapon.attack_crit.length > 0 &&
          intents.get(occupant.id)?.action.type === 'special') {
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

  // Action sub-phases: defend → attack → special. Player first within each.
  // Snapshot the actor order ONCE — combatants get removed mid-phase by reapAndCheck.
  const playerIds = snapshot.filter(c => !c.isAI).map(c => c.id);
  const aiIds     = snapshot.filter(c =>  c.isAI).map(c => c.id);
  const orderedIds = [...playerIds, ...aiIds];

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

  // --- End of round: tick DOT/status sequentially (enemies first), checking
  // for death after each tick. First combatant to reach 0 ends the fight for
  // their team; the other side's DOT never gets to tick.
  let winner: string | null = null;
  const dotOrder = [...session.combatants].sort((a, b) => Number(b.isAI) - Number(a.isAI));
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
