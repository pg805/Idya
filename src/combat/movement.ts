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
  const reachable = new Map<string, Pos>();
  const costs = new Map<string, number>(); // 'x,y:parity' → cost
  costs.set(`${key(from)}:0`, 0);
  const queue: [Pos, number, number][] = [[from, 0, 0]]; // pos, cost, diagParity

  while (queue.length > 0) {
    const [pos, cost, diagParity] = queue.shift()!;
    for (const n of neighbors(pos)) {
      const k = key(n);
      const isDiag = n.x !== pos.x && n.y !== pos.y;
      const stepCost = isDiag ? (diagParity === 0 ? 1 : 2) : 1;
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
      reachable.set(k, n);
      queue.push([n, newCost, newParity]);
    }
  }

  return reachable;
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
