import { Board, Pos } from './board.js';

// BFS reachable tiles. Each step costs 1 (Chebyshev — diagonal cost tunable later).
// Returns a map of 'x,y' → Pos for every tile the combatant can land on.
export function reachableTiles(
  from: Pos,
  range: number,
  board: Board,
  occupied: Set<string>,
): Map<string, Pos> {
  const reachable = new Map<string, Pos>();
  const costs = new Map<string, number>();
  costs.set(key(from), 0);
  const queue: [Pos, number][] = [[from, 0]];

  while (queue.length > 0) {
    const [pos, cost] = queue.shift()!;
    for (const n of neighbors(pos)) {
      const k = key(n);
      const newCost = cost + 1;
      if (newCost > range) continue;
      if (!board.inBounds(n)) continue;
      if (board.isBlocked(n)) continue;
      if ((costs.get(k) ?? Infinity) <= newCost) continue;
      costs.set(k, newCost);
      if (!occupied.has(k)) reachable.set(k, n);
      queue.push([n, newCost]);
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
