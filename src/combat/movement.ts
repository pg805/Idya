import { Board, Pos } from './board.js';

// BFS reachable tiles. Diagonals use alternating cost (1-2-1-2): even diagonal = 1, odd = 2.
// State is (pos, cost, diagParity) so the same tile can be reached via different parity branches.
// Returns a map of 'x,y' → Pos for every tile the combatant can land on.
export function reachableTiles(
  from: Pos,
  range: number,
  board: Board,
  occupied: Set<string>,
): Map<string, Pos> {
  const out = new Map<string, Pos>();
  for (const [k, v] of reachableCosts(from, range, board, occupied)) out.set(k, v.pos);
  return out;
}

// Same BFS, but also returns the cheapest cost to reach each tile. Slow tiles
// charge +1 to leave, so a path that detours around them costs less — callers
// (e.g. the AI) can use cost as a tiebreaker to route around difficult terrain
// while still reaching tiles only available by crossing it.
export function reachableCosts(
  from: Pos,
  range: number,
  board: Board,
  occupied: Set<string>,
): Map<string, { pos: Pos; cost: number }> {
  const reachable = new Map<string, { pos: Pos; cost: number }>();
  const costs = new Map<string, number>(); // 'x,y:parity' → cost
  costs.set(`${key(from)}:0`, 0);
  const queue: [Pos, number, number][] = [[from, 0, 0]]; // pos, cost, diagParity

  while (queue.length > 0) {
    const [pos, cost, diagParity] = queue.shift()!;
    // Leaving a slow tile costs +1 (difficult terrain — affects everyone on it).
    const slowPenalty = board.getTile(pos)?.kind === 'slow' ? 1 : 0;
    for (const n of neighbors(pos)) {
      const k = key(n);
      const isDiag = n.x !== pos.x && n.y !== pos.y;
      const stepCost = (isDiag ? (diagParity === 0 ? 1 : 2) : 1) + slowPenalty;
      const newCost = cost + stepCost;
      const newParity = isDiag ? 1 - diagParity : diagParity;
      const sk = `${k}:${newParity}`;
      if (newCost > range) continue;
      if (!board.inBounds(n)) continue;
      if (board.isBlocked(n)) continue;
      // No diagonal corner-cutting: if both orthogonal neighbors that the
      // diagonal step "squeezes between" are blocked, the diagonal is
      // blocked too. Out-of-bounds doesn't count (board edge isn't a wall).
      if (isDiag) {
        const a = { x: pos.x, y: n.y };
        const b = { x: n.x, y: pos.y };
        if (board.inBounds(a) && board.inBounds(b) && board.isBlocked(a) && board.isBlocked(b)) continue;
      }
      if ((costs.get(sk) ?? Infinity) <= newCost) continue;
      if (occupied.has(k)) continue;
      costs.set(sk, newCost);
      const existing = reachable.get(k);
      if (!existing || newCost < existing.cost) reachable.set(k, { pos: n, cost: newCost });
      queue.push([n, newCost, newParity]);
    }
  }

  return reachable;
}

// Hazard-aware traversal info: cheapest route to a tile that takes the least
// opposing-team hazard damage (then fewest movement points).
export interface ReachDanger {
  pos: Pos;
  cost: number;    // movement points spent
  hazard: number;  // total opposing-hazard damage taken to reach it
}

interface SearchLabel {
  id: number;
  pos: Pos;
  parity: number;
  cost: number;
  hazard: number;
  parent: number;
}

// Shared search. Explores every state reachable within `range` and keeps the
// Pareto-optimal (cost, hazard) labels per (tile, diagParity) — so a longer route
// that dodges a hazard isn't discarded in favour of a short one that eats it, and
// vice-versa when the dodge would overshoot the move budget. `teamId` is the
// mover's team: only *other* teams' hazard tiles count against it. Returns every
// settled (non-dominated) label, with parent ids for path reconstruction.
function searchLabels(
  from: Pos,
  range: number,
  board: Board,
  occupied: Set<string>,
  teamId: string,
): SearchLabel[] {
  let nextId = 0;
  const settled: SearchLabel[] = [];
  const frontier: SearchLabel[] = [{ id: nextId++, pos: { ...from }, parity: 0, cost: 0, hazard: 0, parent: -1 }];
  const nondom = new Map<string, { cost: number; hazard: number }[]>();

  const dominated = (k: string, cost: number, hazard: number) =>
    (nondom.get(k) ?? []).some(l => l.cost <= cost && l.hazard <= hazard);
  const record = (k: string, cost: number, hazard: number) => {
    const arr = (nondom.get(k) ?? []).filter(l => !(cost <= l.cost && hazard <= l.hazard));
    arr.push({ cost, hazard });
    nondom.set(k, arr);
  };

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost || a.hazard - b.hazard);
    const cur = frontier.shift()!;
    const ck = `${key(cur.pos)}:${cur.parity}`;
    if (dominated(ck, cur.cost, cur.hazard)) continue;
    record(ck, cur.cost, cur.hazard);
    settled.push(cur);

    const slowPenalty = board.getTile(cur.pos)?.kind === 'slow' ? 1 : 0;
    for (const n of neighbors(cur.pos)) {
      const k = key(n);
      const isDiag = n.x !== cur.pos.x && n.y !== cur.pos.y;
      const stepCost = (isDiag ? (cur.parity === 0 ? 1 : 2) : 1) + slowPenalty;
      const newCost = cur.cost + stepCost;
      const newParity = isDiag ? 1 - cur.parity : cur.parity;
      if (newCost > range) continue;
      if (!board.inBounds(n)) continue;
      if (board.isBlocked(n)) continue;
      if (isDiag) {
        const a = { x: cur.pos.x, y: n.y };
        const b = { x: n.x, y: cur.pos.y };
        if (board.inBounds(a) && board.inBounds(b) && board.isBlocked(a) && board.isBlocked(b)) continue;
      }
      if (occupied.has(k)) continue;
      const tile = board.getTile(n);
      const haz = tile && tile.kind === 'hazard' && tile.teamId !== teamId ? tile.value : 0;
      const newHazard = cur.hazard + haz;
      const sk = `${k}:${newParity}`;
      if (dominated(sk, newCost, newHazard)) continue;
      frontier.push({ id: nextId++, pos: { ...n }, parity: newParity, cost: newCost, hazard: newHazard, parent: cur.id });
    }
  }

  return settled;
}

// Per-tile cheapest *and* safest reachability: for every tile in range, the label
// with least hazard taken, then least movement cost. Used by the AI to prefer
// destinations and routes that avoid opposing hazard tiles. (Reachability matches
// reachableTiles — hazards change the route, not which tiles can be reached.)
export function reachableDanger(
  from: Pos,
  range: number,
  board: Board,
  occupied: Set<string>,
  teamId: string,
): Map<string, ReachDanger> {
  const out = new Map<string, ReachDanger>();
  for (const l of searchLabels(from, range, board, occupied, teamId)) {
    if (l.pos.x === from.x && l.pos.y === from.y) continue;
    const tk = key(l.pos);
    const prev = out.get(tk);
    if (!prev || l.hazard < prev.hazard || (l.hazard === prev.hazard && l.cost < prev.cost)) {
      out.set(tk, { pos: { ...l.pos }, cost: l.cost, hazard: l.hazard });
    }
  }
  return out;
}

// Reconstruct the route from `from` to `to` that takes the least opposing-hazard
// damage (then fewest movement points), within `range`. Returns the ordered
// squares *entered* — every tile after `from`, ending at `to` — or null if `to`
// isn't reachable. `from` itself is excluded (no re-trigger on the square you
// started on). Used to apply per-square hazard damage AND to actually route units
// around hazards instead of straight through them.
export function findPath(
  from: Pos,
  to: Pos,
  range: number,
  board: Board,
  occupied: Set<string>,
  teamId: string,
): Pos[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  const labels = searchLabels(from, range, board, occupied, teamId);
  const byId = new Map<number, SearchLabel>(labels.map(l => [l.id, l]));

  // Best label landing on `to`: least hazard, then least cost.
  let best: SearchLabel | null = null;
  for (const l of labels) {
    if (l.pos.x !== to.x || l.pos.y !== to.y) continue;
    if (!best || l.hazard < best.hazard || (l.hazard === best.hazard && l.cost < best.cost)) best = l;
  }
  if (!best) return null;

  const path: Pos[] = [];
  let cur: SearchLabel | undefined = best;
  while (cur && cur.parent !== -1) {
    path.push({ ...cur.pos });
    cur = byId.get(cur.parent);
  }
  path.reverse();
  return path;
}

function key(pos: Pos): string {
  return `${pos.x},${pos.y}`;
}

function neighbors(pos: Pos): Pos[] {
  const result: Pos[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      result.push({ x: pos.x + dx, y: pos.y + dy });
    }
  }
  return result;
}
