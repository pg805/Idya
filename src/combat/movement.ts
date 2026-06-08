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

// Reconstruct a cheapest-cost step path from `from` to `to` (same cost model as
// reachableTiles). Returns the ordered squares *entered* — every tile after
// `from`, ending at `to` — or null if `to` isn't reachable within `range`. Used
// to apply per-square effects (hazard damage) as a combatant moves, instead of
// only checking the destination. `from` itself is excluded (no re-trigger on the
// square you started on).
export function findPath(
  from: Pos,
  to: Pos,
  range: number,
  board: Board,
  occupied: Set<string>,
): Pos[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  const startKey = `${key(from)}:0`;
  const costs = new Map<string, number>([[startKey, 0]]);
  const parent = new Map<string, { sk: string; pos: Pos }>();
  const queue: [Pos, number, number][] = [[from, 0, 0]];

  while (queue.length > 0) {
    const [pos, cost, diagParity] = queue.shift()!;
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
      if (isDiag) {
        const a = { x: pos.x, y: n.y };
        const b = { x: n.x, y: pos.y };
        if (board.inBounds(a) && board.inBounds(b) && board.isBlocked(a) && board.isBlocked(b)) continue;
      }
      if ((costs.get(sk) ?? Infinity) <= newCost) continue;
      if (occupied.has(k)) continue;
      costs.set(sk, newCost);
      parent.set(sk, { sk: `${key(pos)}:${diagParity}`, pos: { ...pos } });
      queue.push([n, newCost, newParity]);
    }
  }

  // Cheapest state reaching `to` across both diagonal parities.
  let bestSk: string | null = null;
  let bestCost = Infinity;
  for (const p of [0, 1]) {
    const sk = `${key(to)}:${p}`;
    const c = costs.get(sk);
    if (c !== undefined && c < bestCost) { bestCost = c; bestSk = sk; }
  }
  if (!bestSk) return null;

  const path: Pos[] = [];
  let curSk: string | null = bestSk;
  let curPos: Pos = to;
  while (curSk && curSk !== startKey) {
    path.push({ ...curPos });
    const par = parent.get(curSk);
    if (!par) break;
    curPos = par.pos;
    curSk = par.sk;
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
