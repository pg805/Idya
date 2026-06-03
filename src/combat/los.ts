import { Board, Pos } from './board.js';

// Bresenham's line — returns false if any intermediate tile is a non-destroyed obstacle
export function hasLineOfSight(from: Pos, to: Pos, board: Board): boolean {
  let x = from.x, y = from.y;
  const dx = Math.abs(to.x - x), dy = Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1;
  let err = dx - dy;

  while (x !== to.x || y !== to.y) {
    const e2 = 2 * err;
    const advX = e2 > -dy;
    const advY = e2 < dx;
    // Diagonal step — sight can't squeeze between two corner obstacles
    // (matches the movement-side no-corner-cut rule).
    if (advX && advY) {
      const a = { x: x + sx, y };
      const b = { x, y: y + sy };
      if (board.inBounds(a) && board.inBounds(b) && board.isBlocked(a) && board.isBlocked(b)) {
        return false;
      }
    }
    if (advX) { err -= dy; x += sx; }
    if (advY) { err += dx; y += sy; }
    if (x === to.x && y === to.y) break;
    if (board.isBlocked({ x, y })) return false;
  }
  return true;
}
