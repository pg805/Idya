import { CombatSession, Combatant, CombatantMeta, ReplayIntent } from './combat_session.js';
import { CombatIntent } from './intent.js';
import { chebyshevDist } from './board.js';
import { hasLineOfSight } from './los.js';
import { resolve_action, strikeBreakdown, FLAVOR_MARK } from './action_resolver.js';
import Action, { SELF_TARGET_TYPES, TILE_TYPES, ActionType } from '../weapon/action.js';
import Strike from '../weapon/action/strike.js';
import TileAction from '../weapon/action/tile_action.js';
import DestroyObstacle from '../weapon/action/destroy_obstacle.js';
import { reachableTiles, findPath } from './movement.js';
import { effectiveMove } from './combatant_state.js';

export interface ResolutionResult {
  log: string[];
  winner: string | null;
  record: { intents: Record<string, ReplayIntent> };  // structured per-turn replay data
}

function pushLog(log: string[], text: string) {
  for (const line of text.split('\n')) {
    // Keep LEADING indent (the client uses it to tell resolution lines from the
    // action header / flavor); drop trailing space and skip blank lines.
    if (line.trim()) log.push(line.replace(/\s+$/, ''));
  }
}

// Category triangle: Defend ▶ Attack ▶ Special ▶ Defend. Called once per action
// sub-phase (`phaseFilter`): every unit whose action category == this phase and
// BEATS an opposing unit's category gets its matching crit, resolved AS PART of
// that phase — so a defend-crit's extra block lands before the attack phase, an
// attack-crit fires before the special it beats, etc.
// — a separate payload (resolve_action) fired at that foe. The crit is just an
// action, so it can be ANY type (strike riposte, extra block, a debuff, …) and
// fires regardless of the main action's type (a self-target shield still crits a
// guard). It's gated by RANGE: the crit reaches at least as far as the action you
// used this turn, extendable by the crit's own Range — so a melee riposte can't
// catch a ranged attacker, while an attack-crit reaches whoever your attack hit.
//   attack → special : attack_crit    special → defend : special_crit
//   defend → attack  : defend_crit (the defender ripostes the attacker)
//
// A crit only fires when one side actually ACTS ON the other — you're targeting
// the foe, or being targeted by them. Two self-only actions (e.g. both units just
// restoring resource: a self-restore Special vs a self-restore Defend) counter
// nothing, so they fire no crit. These are the types that engage an opponent:
const OFFENSIVE_TYPES = new Set<number>([
  ActionType.Strike, ActionType.DamageOverTime, ActionType.Debuff, ActionType.MoveDebuff, ActionType.HazardTile,
]);
const isOffensive = (a?: Action): boolean => a !== undefined && OFFENSIVE_TYPES.has(a.type);

// Did `action` (with its `intent`) actually act ON `tgtPos` this turn — not just
// pick a winning category? An AIMED attack engages only the tile it was aimed at
// (or, for an AOE, a tile inside the block centered there); a REACTIVE attack
// engages foes within its range, or anything in its self-burst block. A non-
// offensive or un-aimed-at-nothing action engages no one. This is what gates a
// crit: attacking empty air or a different unit provokes no counter.
function critEngages(action: Action | undefined, intent: CombatIntent | undefined, srcPos: { x: number; y: number }, tgtPos: { x: number; y: number }): boolean {
  if (!isOffensive(action) || !intent) return false;
  const hits = (p: { x: number; y: number }): boolean => p.x === tgtPos.x && p.y === tgtPos.y;
  if (action!.aimed) {
    const tp = intent.action.targetPos;
    if (!tp) return false;                                   // aimed at nothing
    return action!.area > 1 ? areaBlock(tp, action!.area, srcPos).some(hits) : hits(tp);
  }
  return action!.area > 1
    ? areaBlock(srcPos, action!.area, srcPos).some(hits)     // reactive self-burst
    : chebyshevDist(srcPos, tgtPos) <= (action!.range ?? 1); // reactive single: nearest in range
}

function resolveTriangleCrits(session: CombatSession, intents: Map<string, CombatIntent>, log: string[], phaseFilter: 'defend' | 'attack' | 'special'): void {
  const BEATS: Record<string, string> = { attack: 'special', special: 'defend', defend: 'attack' };
  const CRIT: Record<string, string> = { attack: 'attack_crit', special: 'special_crit', defend: 'defend_crit' };
  const VERB: Record<string, string> = { attack: 'catches', special: 'punishes the guard of', defend: 'counters' };
  for (const actor of [...session.combatants]) {
    const aIntent = intents.get(actor.id);
    const aCat = aIntent?.action.type;
    if (!aCat || !(aCat in BEATS)) continue;
    if (aCat !== phaseFilter) continue;   // only this sub-phase's crits fire here
    const aMeta = session.meta.get(actor.id);
    if (!aMeta || aMeta.state.health <= 0) continue;
    const lists = aMeta.weapon as unknown as Record<string, Action[]>;
    const crits = lists[CRIT[aCat]];
    if (!crits || crits.length === 0) continue;
    const myAction = lists[aCat]?.[aIntent!.action.actionIndex];
    const myRange = myAction?.range ?? 1;
    // Self-target crits (heal/block/shield/reflect/buff) land on ME; a tile crit
    // drops a zone on MY square; both count as "self" (no reach needed, fire once).
    // Foe-target crits (strike/DOT/debuff) land on the foe and must REACH it.
    const crit0 = crits[0];
    const isTile = TILE_TYPES.has(crit0.type);
    const isSelf = isTile || SELF_TARGET_TYPES.has(crit0.type);
    const critReach = Math.max(crit0.range ?? 1, myRange);
    for (const foe of session.combatants) {
      if (foe.teamId === actor.teamId) continue;
      const fIntent = intents.get(foe.id);
      if (fIntent?.action.type !== BEATS[aCat]) continue;
      const fMeta = session.meta.get(foe.id);
      if (!fMeta || fMeta.state.health <= 0) continue;
      const foeAction = (fMeta.weapon as unknown as Record<string, Action[]>)[BEATS[aCat]]?.[fIntent.action.actionIndex];
      // A crit only fires when one side actually TARGETED the other this turn — not
      // just because the categories line up. So a defend-crit counters an attacker
      // only if that attacker actually attacked the defender (aimed at its tile, or
      // a reactive/AOE that caught it); attacking empty air provokes no counter.
      const engaged = critEngages(myAction, aIntent, actor.pos, foe.pos)
                   || critEngages(foeAction, fIntent, foe.pos, actor.pos);
      if (!engaged) continue;
      const dist = chebyshevDist(actor.pos, foe.pos);
      if (!isSelf && dist > critReach) continue;          // a foe-aimed crit must still reach
      aMeta.state.attack_crits += 1;
      log.push(`★ ${actor.name} ${VERB[aCat]} ${foe.name}!`);
      if (isTile) {
        // Drop the crit's tile on the caster's own square (a self/ally zone).
        const kind = crit0.type === ActionType.BlockTile ? 'block' : crit0.type === ActionType.BuffTile ? 'buff'
                   : crit0.type === ActionType.SlowTile ? 'slow' : 'hazard';
        const value = (crit0 as unknown as { value: number }).value;
        for (const p of areaBlock(actor.pos, crit0.area, actor.pos))
          if (session.board.inBounds(p) && !session.board.isBlocked(p)) session.board.setTile({ pos: p, teamId: actor.teamId, kind, value });
        log.push(`${actor.name} — ${crit0.name}: drops a ${kind} tile.`);
      } else {
        // Split the payload by target so a MIXED crit lands each half on the right
        // unit. resolve_action routes block/reflect/shield to the actor but Buff/Heal
        // via the TARGET arg — so self-target types (block/buff/heal/shield/reflect)
        // must resolve against ME, hostile types (strike/DOT/debuff) against the foe.
        // A homogeneous payload just takes one of the two branches.
        const selfCrits = crits.filter(c => SELF_TARGET_TYPES.has(c.type));
        const foeCrits  = crits.filter(c => !SELF_TARGET_TYPES.has(c.type));
        if (selfCrits.length) pushLog(log, resolve_action(aMeta.state, aMeta.state, selfCrits));
        if (foeCrits.length) {
          pushLog(log, resolve_action(aMeta.state, fMeta.state, foeCrits));
          // resolve_action only deals damage — a crit strike's Push (knockback)
          // rider must be applied separately, exactly like the main strike paths do.
          for (const c of foeCrits)
            if (c.push > 0 && fMeta.state.health > 0) knockback(actor.pos, foe, c.push, session, log);
        }
      }
      if (isSelf) break;   // a self crit triggers once, not per attacker
    }
  }
}

// N×N block of positions. Odd N centers on `center`. Even N puts `center` at the
// corner nearest the caster and sprays *away* from them (so the zone lands ahead
// of where they aimed). Callers filter out off-board / obstacle squares.
export function areaBlock(center: { x: number; y: number }, area: number, caster: { x: number; y: number }): { x: number; y: number }[] {
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

// Knock `target` up to `squares` tiles directly away from `from` (8-directional,
// along the from→target line). Stops early at the board edge, an obstacle, or
// another unit — no shoving through walls or stacking. Used by the Push rider.
function knockback(
  from: { x: number; y: number },
  target: { id: string; name: string; pos: { x: number; y: number } },
  squares: number,
  session: CombatSession,
  log: string[],
): void {
  const dx = Math.sign(target.pos.x - from.x);
  const dy = Math.sign(target.pos.y - from.y);
  if (dx === 0 && dy === 0) return;
  let moved = 0;
  for (let i = 0; i < squares; i++) {
    const next = { x: target.pos.x + dx, y: target.pos.y + dy };
    if (!session.board.inBounds(next) || session.board.isBlocked(next)) break;
    if (session.combatants.some(c => c.id !== target.id && c.pos.x === next.x && c.pos.y === next.y)) break;
    target.pos = next;
    moved++;
  }
  if (moved > 0) log.push(`  ${target.name} is knocked back ${moved} square${moved > 1 ? 's' : ''} to (${target.pos.x},${target.pos.y}).`);
}

export function resolveIntents(
  session: CombatSession,
  intents: Map<string, CombatIntent>,
): ResolutionResult {
  const log: string[] = [];

  const snapshot = [...session.combatants];
  // Pre-move positions, so each turn's replay path is a self-contained from→to.
  const preMovePos = new Map(snapshot.map(c => [c.id, { x: c.pos.x, y: c.pos.y }]));

  // Record each unit's committed category so next turn's planner can nudge away
  // from repeating it (a `pass` isn't a real category choice, so it's skipped).
  for (const [id, intent] of intents) {
    if (intent.action.type === 'pass') continue;
    const m = session.meta.get(id);
    if (m) m.state.last_category = intent.action.type;
  }

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
  // Destination a unit was DENIED (lost a tile contest, or it was occupied). Kept
  // even after an AI re-routes, so the move line can show "… ✗ (denied)" — one
  // line carries both where it got to and the square it couldn't reach.
  const blockedDest = new Map<string, { x: number; y: number }>();

  for (const [, claimants] of byDest) {
    if (claimants.length === 1) continue;
    const sortedByPriority = [...claimants].sort((a, b) => movePriority(a) - movePriority(b));
    const winner = sortedByPriority[0];
    for (const id of claimants) {
      if (id !== winner) {
        blocked.add(id);
        const d = intents.get(id)?.moveTo;
        if (d) blockedDest.set(id, { ...d });
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
    if (stationaryOccupant) { blocked.add(id); blockedDest.set(id, { ...dest }); }
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

    const cReachMeta = session.meta.get(id);
    const cMove = cReachMeta ? effectiveMove(c.movementRange, cReachMeta.state) : c.movementRange;
    const reachable = reachableTiles(c.pos, cMove, session.board, allOccupied);

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
    // Movement is a walk, not a teleport — hazards hit every square entered. Both
    // players and AI route around pits (and slow) when a within-range detour
    // exists, and wade through only when forced. The client preview runs the same
    // avoidance, so the green outline matches the damage taken. (Manual route
    // choice — deliberately picking a different equal-cost route — is future work.)
    const moverMeta = session.meta.get(id);
    const moverRange = moverMeta ? effectiveMove(c.movementRange, moverMeta.state) : c.movementRange;
    const path = findPath(from, intent.moveTo, moverRange, session.board, new Set(), c.teamId, true) ?? [intent.moveTo];
    moverPaths.set(id, path);
    c.pos = intent.moveTo;
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
  // Move section: only units that actually MOVED (or were denied a square) — a
  // holder standing still says nothing, so it's dropped. The line: ⚡initiative,
  // name, the full traversed path; a denied unit appends "✗ (denied)", whether it
  // stayed put ("(from) ✗ (dest)") or re-routed partway ("(from) → (mid) ✗ (dest)").
  const moveLines: string[] = [];
  for (const c of [...session.combatants].sort((a, b) => movePriority(a.id) - movePriority(b.id))) {
    const meta = session.meta.get(c.id);
    if (!meta || meta.state.health <= 0) continue;
    const from = preMovePos.get(c.id) ?? c.pos;
    const denied = blockedDest.get(c.id);
    const moved = from.x !== c.pos.x || from.y !== c.pos.y;
    if (!moved && !denied) continue;   // a unit that held its square is noise
    let pathStr = [from, ...(moverPaths.get(c.id) ?? [])].map(p => `(${p.x},${p.y})`).join(' → ');
    if (denied) pathStr += ` ✗ (${denied.x},${denied.y})`;
    moveLines.push(`⚡${c.initiative} ${c.name}  ${pathStr}`);
  }
  if (moveLines.length) log.splice(moveStart, 0, '▸ Move', ...moveLines);

  // Capture this turn's structured record for the downloadable replay: every
  // unit's traversed path (every square entered) + the action it committed.
  // Built here, after moves resolve so paths are final, and reused by whichever
  // return fires below.
  const recordIntents: Record<string, ReplayIntent> = {};
  for (const [id, intent] of intents) {
    const meta = session.meta.get(id);
    const from = preMovePos.get(id);
    const entered = moverPaths.get(id);   // squares ENTERED (excludes origin)
    const full = from ? [from, ...(entered ?? [])] : (entered ?? []);   // self-contained from→to
    const cat = intent.action.type;
    const list = meta ? (meta.weapon as unknown as Record<string, Action[]>)[cat] : undefined;
    const name = cat === 'pass' ? 'pass' : (list?.[intent.action.actionIndex]?.name ?? cat);
    const tp = intent.action.targetPos;
    recordIntents[id] = {
      path: full.map(p => [p.x, p.y] as [number, number]),
      action: { cat, name, target: tp ? [tp.x, tp.y] : null },
    };
  }
  const record = { intents: recordIntents };

  // --- Action phase ---
  // Ordered: defend → attack → special. Within each category, player(s) before AI.
  // After every individual action we sync HP, remove dead combatants, and end the
  // fight if a team is wiped. This makes "Defend beats Attack" actually true
  // (defends go up before attacks land) and matches the rock-paper-scissors the
  // tutorial teaches.

  // === Per-action handlers ===
  // Each resolves one actor's committed action against the shared session/log.
  // Split out of the old monolithic runAction so every targeting mode reads on
  // its own; runAction (below) is just the validate-and-dispatch front door.

  const isDamaging = (a: Action) => a.type === ActionType.Strike || a.type === ActionType.DamageOverTime;

  const nearestEnemyTo = (actor: Combatant): Combatant | null => {
    const enemies = session.combatants.filter(c => c.teamId !== actor.teamId);
    if (enemies.length === 0) return null;
    return enemies.reduce((a, b) => chebyshevDist(actor.pos, a.pos) <= chebyshevDist(actor.pos, b.pos) ? a : b);
  };

  // Resolve an N×N strike over a precomputed block of `cells`. If the action
  // smashes, flatten every obstacle in the block FIRST — that opens line of
  // sight, so the blow reaches anyone who was hiding behind the cover it just
  // levelled. Then each enemy in the block with LOS from the caster takes the
  // hit; cost is paid once. Shared by the aimed AOE (block centered on the
  // target tile) and the reactive self-burst (block centered on the actor).
  // Strip apply_cost's "  [−2 Flow]" wrapper down to a bare "−2 Flow" for use as
  // an indented resolution line under an AOE header.
  const bareCost = (rs: string): string => rs ? rs.replace(/^\s*\[/, '').replace(/\]$/, '') : '';

  // Standard "the action fizzled" block: the header in the same shape as a real
  // resolution ("<actor> — <action>: <reason>") plus the cost on its own
  // resolution line. Used by every aimed/reactive guard (out of range, no LOS,
  // empty tile, …) so a wasted action reads identically to a landed one.
  const logMiss = (actor: Combatant, actorMeta: CombatantMeta, action: Action, reason: string): void => {
    const cost = bareCost(actorMeta.state.apply_cost(action));
    log.push(`${actor.name} — ${action.name}: ${reason}`);
    if (cost) log.push(`    ${cost}`);
  };

  const resolveAoeStrike = (actor: Combatant, actorMeta: CombatantMeta, action: Action, intent: CombatIntent, cells: Set<string>, label: string, extra: string[] = []): void => {
    const { weapon } = actorMeta;
    if (action.smash) {
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number);
        if (session.board.inBounds({ x, y }) && session.board.destroyObstacle({ x, y }))
          log.push(`  ${action.name} flattens the obstacle at (${x},${y}).`);
      }
    }
    const victims = session.combatants.filter(c => c.teamId !== actor.teamId && cells.has(`${c.pos.x},${c.pos.y}`));
    if (victims.length === 0) {
      const cost = bareCost(actorMeta.state.apply_cost(action));
      log.push(`${actor.name} — ${action.name}: ${label} catches no one`);
      for (const e of extra) log.push(`    ${e}`);   // e.g. "blink to (0,3)"
      if (cost) log.push(`    ${cost}`);
      return;
    }
    const cost = bareCost(actorMeta.state.apply_cost(action));  // pay once
    if (action.aimed && isDamaging(action)) actorMeta.state.aimed_hit += 1;

    if (action.type === ActionType.Strike) {
      // Merge the whole blast into ONE block: flavor, the blast action line, then
      // a single resolve stack — blink + the shared cost (paid once) + each
      // victim's roll breakdown and Total. (Strikes only; DOT/debuff areas keep
      // the generic per-victim path below, since their resolution differs.)
      const resolveLines: string[] = [];
      for (const e of extra) resolveLines.push(`    ${e}`);   // blink to (tile)
      const live = victims.filter(v => { const m = session.meta.get(v.id); return !!m && m.state.health > 0; });
      let firstHit: Combatant | undefined;
      for (const v of live) {
        const m = session.meta.get(v.id)!;
        if (!hasLineOfSight(actor.pos, v.pos, session.board)) {
          resolveLines.push(`    ${v.name} shielded by an obstacle`);
          continue;
        }
        firstHit = firstHit ?? v;
        if (live.length > 1) resolveLines.push(`    vs ${v.name}:`);
        const { damage, lines } = strikeBreakdown(actorMeta.state, m.state, action as Strike);
        resolveLines.push(...lines, `    Total ${damage}`);
        // A struck victim's reflect bounces back to the caster (the single-target
        // path gets this via resolve_action; the merged AOE path must do it too).
        if (m.state.reflect.value > 0) {
          const refl = m.state.reflect.value;
          actorMeta.state.health = Math.max(actorMeta.state.health - refl, 0);
          actorMeta.state.damage_taken += refl;
          resolveLines.push(`    ↺ ${refl} reflected to ${actor.name}`);
        }
        if (action.push > 0 && m.state.health > 0) knockback(actor.pos, v, action.push, session, resolveLines);
      }
      if (cost) resolveLines.push(`    ${cost}`);   // shared cost, paid once — at the foot of the stack
      const flavor = action.action_string.replace(/<User>/g, actor.name).replace(/<Target>/g, firstHit?.name ?? 'the area');
      log.push(`${FLAVOR_MARK}${flavor}`);
      log.push(`${actor.name} — ${action.name}: ${label}`);
      for (const l of resolveLines) log.push(l);
      return;
    }

    // Generic AOE (DOT / debuff / …): summary header, then each victim's own
    // resolution. Cost already paid above, so zero it for the per-victim calls.
    const savedCost = action.cost;
    action.cost = 0;
    log.push(`${actor.name} — ${action.name}: ${label}.`);
    for (const e of extra) log.push(`    ${e}`);
    if (cost) log.push(`    ${cost}`);
    for (const v of victims) {
      const m = session.meta.get(v.id);
      if (!m || m.state.health <= 0) continue;
      // An obstacle between the caster and a victim shields them from the blast.
      if (!hasLineOfSight(actor.pos, v.pos, session.board)) {
        log.push(`  ${v.name} is shielded from ${action.name} by an obstacle.`);
        continue;
      }
      pushLog(log, resolve_action(actorMeta.state, m.state, [action]));
      if (action.push > 0 && m.state.health > 0) knockback(actor.pos, v, action.push, session, log);
    }
    action.cost = savedCost;
  };

  // Tile creators (block/buff/hazard/slow): drop a tile, or an N×N block of them.
  const resolveTileAction = (actor: Combatant, actorMeta: CombatantMeta, action: Action, intent: CombatIntent): void => {
    const tileCost = bareCost(actorMeta.state.apply_cost(action));
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
    if (tileCost) log.push(`    ${tileCost}`);
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
  };

  // Destroy Obstacle: aimed at an obstacle in range; destroy it and AOE its
  // field to enemies within 1 tile of the wreck. Resistances apply; the blast
  // bypasses block/shield.
  const resolveDestroyObstacle = (actor: Combatant, actorMeta: CombatantMeta, action: Action, intent: CombatIntent): void => {
    const cost = bareCost(actorMeta.state.apply_cost(action));
    const fizzle = (reason: string): void => {
      log.push(`${actor.name} — ${action.name}: ${reason}`);
      if (cost) log.push(`    ${cost}`);
    };
    const targetPos = intent.action.targetPos;
    if (!targetPos) { fizzle('no target'); return; }
    const dist = chebyshevDist(actor.pos, targetPos);
    if (dist > action.range) { fizzle(`out of range (dist ${dist})`); return; }
    if (!session.board.destroyObstacle(targetPos)) { fizzle(`no obstacle at (${targetPos.x},${targetPos.y}), misses`); return; }
    const field = (action as DestroyObstacle).field;
    log.push(`${actor.name} — ${action.name}: shatters the obstacle at (${targetPos.x},${targetPos.y})!`);
    if (cost) log.push(`    ${cost}`);
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
  };

  // Self-target buff/heal/block/etc. — fires on the actor regardless of position.
  const resolveSelfTarget = (actorMeta: CombatantMeta, action: Action): void => {
    pushLog(log, resolve_action(actorMeta.state, actorMeta.state, [action]));
  };

  // Aimed strike: a chosen target tile in range (LOS-checked for range > 1).
  // Area > 1 blasts the N×N centered on that tile; else hit the single occupant.
  const resolveAimedStrike = (actor: Combatant, actorMeta: CombatantMeta, action: Action, intent: CombatIntent): void => {
    const { weapon } = actorMeta;
    const targetPos = intent.action.targetPos;
    // No target tile (the AI picked an aimed action with nothing in range). Log it
    // rather than silently vanishing — an un-logged action makes the whole phase
    // header drop, which reads as the enemy "skipping" its turn.
    if (!targetPos) {
      logMiss(actor, actorMeta, action, 'no target in range');
      return;
    }

    const dist = chebyshevDist(actor.pos, targetPos);
    const tileStr = `(${targetPos.x},${targetPos.y})`;

    if (dist > action.range) {
      logMiss(actor, actorMeta, action, `out of range (dist ${dist})`);
      return;
    }
    if (action.range > 1 && !hasLineOfSight(actor.pos, targetPos, session.board)) {
      logMiss(actor, actorMeta, action, 'no line of sight');
      return;
    }

    if (action.area > 1) {
      // Blink-strike (MoveTo): relocate the caster to the aimed tile, then burst
      // from there. The tile must be empty + passable (UI only offers such tiles);
      // if somehow blocked, skip the move and burst from where we stand.
      const extra: string[] = [];
      if (action.moveTo) {
        const occupied = session.combatants.some(c => c.id !== actor.id && c.pos.x === targetPos.x && c.pos.y === targetPos.y);
        if (session.board.inBounds(targetPos) && !session.board.isBlocked(targetPos) && !occupied) {
          actor.pos = { x: targetPos.x, y: targetPos.y };
          extra.push(`blink to ${tileStr}`);   // shown as a resolution line under the header
        }
      }
      const cells = new Set(areaBlock(targetPos, action.area, actor.pos).map(p => `${p.x},${p.y}`));
      resolveAoeStrike(actor, actorMeta, action, intent, cells, `${action.area}×${action.area} blast at ${tileStr}`, extra);
      return;
    }

    const occupant = session.combatants.find(c => c.pos.x === targetPos.x && c.pos.y === targetPos.y);
    if (!occupant) {
      logMiss(actor, actorMeta, action, `aimed at ${tileStr}, empty space`);
      return;
    }
    if (occupant.teamId === actor.teamId && action.type !== ActionType.Heal && action.type !== ActionType.Buff) {
      log.push(`${actor.name} — ${action.name}: friendly fire avoided at ${tileStr}`);
      return;
    }

    const targetMeta = session.meta.get(occupant.id);
    if (!targetMeta) return;
    if (isDamaging(action)) actorMeta.state.aimed_hit += 1;
    pushLog(log, resolve_action(actorMeta.state, targetMeta.state, [action]));
    if (action.push > 0 && targetMeta.state.health > 0) knockback(actor.pos, occupant, action.push, session, log);
  };

  // Reactive strike (no aim). Area > 1 ⇒ a self-centered burst (the N×N around
  // the actor — a melee smash, no target tile): odd N centers on the actor; even
  // N has no center, so it sprays toward the nearest enemy (NW if none), fed to
  // areaBlock via a phantom caster one step opposite the spray. Area 1 ⇒ the
  // classic single nearest target.
  const resolveReactiveStrike = (actor: Combatant, actorMeta: CombatantMeta, action: Action, intent: CombatIntent): void => {
    const { weapon } = actorMeta;
    if (action.area > 1) {
      let sprayFrom = actor.pos;
      if (action.area % 2 === 0) {
        const foe = nearestEnemyTo(actor);
        const dx = foe ? (Math.sign(foe.pos.x - actor.pos.x) || -1) : -1;
        const dy = foe ? (Math.sign(foe.pos.y - actor.pos.y) || -1) : -1;
        sprayFrom = { x: actor.pos.x - dx, y: actor.pos.y - dy };
      }
      const cells = new Set(areaBlock(actor.pos, action.area, sprayFrom).map(p => `${p.x},${p.y}`));
      resolveAoeStrike(actor, actorMeta, action, intent, cells, `${action.area}×${action.area} burst`);
      return;
    }
    const enemies = session.combatants.filter(c => c.teamId !== actor.teamId);
    const inRange = enemies.filter(e => chebyshevDist(actor.pos, e.pos) <= action.range);

    if (inRange.length === 0) {
      logMiss(actor, actorMeta, action, 'no target in range');
      return;
    }

    const target = inRange.reduce((a, b) =>
      chebyshevDist(actor.pos, a.pos) <= chebyshevDist(actor.pos, b.pos) ? a : b
    );
    const targetMeta = session.meta.get(target.id);
    if (!targetMeta) return;
    pushLog(log, resolve_action(actorMeta.state, targetMeta.state, [action]));
    if (action.push > 0 && targetMeta.state.health > 0) knockback(actor.pos, target, action.push, session, log);
  };

  // Dispatcher: validate the actor + action, then route to the right handler.
  const runAction = (id: string): void => {
    const intent = intents.get(id);
    if (!intent || intent.action.type === 'pass') return;

    const actor = session.combatants.find(c => c.id === id);
    if (!actor) return;

    const actorMeta = session.meta.get(id);
    if (!actorMeta) return;

    if (actorMeta.state.health <= 0) return; // killed earlier this turn, can't act

    const { weapon } = actorMeta;
    let action: Action | null = null;
    if (intent.action.type === 'defend')  action = weapon.defend[intent.action.actionIndex]  ?? null;
    if (intent.action.type === 'attack')  action = weapon.attack[intent.action.actionIndex]  ?? null;
    if (intent.action.type === 'special') action = weapon.special[intent.action.actionIndex] ?? null;

    if (!action) return;

    if (action.cost > 0 && action.cost > actorMeta.state.resource_current) {
      log.push(`${actor.name} cannot afford ${action.name}.`);
      return;
    }

    // Board-effect actions resolve before the combat-stat counters below.
    if (TILE_TYPES.has(action.type)) return resolveTileAction(actor, actorMeta, action, intent);
    if (action.type === ActionType.DestroyObstacle) return resolveDestroyObstacle(actor, actorMeta, action, intent);

    // Dev stat counters: restore economy (cost < 0) and aimed-attack hit rate.
    if (action.cost < 0) actorMeta.state.restores += 1;
    if (action.aimed && isDamaging(action)) actorMeta.state.aimed_attempted += 1;

    if (SELF_TARGET_TYPES.has(action.type) && !action.targeted) return resolveSelfTarget(actorMeta, action);
    if (action.aimed) return resolveAimedStrike(actor, actorMeta, action, intent);
    return resolveReactiveStrike(actor, actorMeta, action, intent);
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
    // This category's counter-crits resolve as PART of the phase (not a trailing
    // lump), so a defend-crit's extra block/riposte lands before the attack phase.
    // They log under this phase's header (▸ Defend/Attack/Special).
    resolveTriangleCrits(session, intents, log, phase);
    const cw = reapAndCheck('damage');
    if (cw !== null) { earlyWinner = cw; break outer; }
    // Drop the header if nothing fired in this phase — keeps the log
    // visually scannable instead of dotted with empty section markers.
    if (log.length === phaseStart + 1) log.pop();
  }

  if (earlyWinner !== null || session.teams.some(t => t.combatants.length === 0)) {
    session.turn++;
    session.phase = 'ended';
    session.pendingIntents.clear();
    return { log, winner: earlyWinner, record };
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

  return { log, winner, record };
}
