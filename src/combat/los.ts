import { Board, Pos } from './board.js';

// Bresenham's line — returns false if any intermediate tile is a non-destroyed obstacle
export function hasLineOfSight(from: Pos, to: Pos, board: Board): boolean {
  let x = from.x, y = from.y;
  const dx = Math.abs(to.x - x), dy = Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1;
  let err = dx - dy;

  while (x !== to.x || y !== to.y) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === to.x && y === to.y) break;
    if (board.isBlocked({ x, y })) return false;
  }
  return true;
}
