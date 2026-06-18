export type Pos = { x: number; y: number };
export type ObstacleState = 'intact' | 'damaged' | 'destroyed';

export interface Obstacle {
  pos: Pos;
  state: ObstacleState;
}

export interface BoardConfig {
  width: number;
  height: number;
  obstacles: Obstacle[];
}

// Board-effect tiles (0.2.0 positional layer). Permanent; placing on an occupied
// square overwrites the existing tile.
export type TileKind = 'block' | 'buff' | 'hazard' | 'slow';
export interface Tile {
  pos: Pos;
  teamId: string;   // tile's owner team — allies benefit (block/buff), foes trigger (hazard)
  kind: TileKind;
  value: number;
}

export class Board {
  readonly width: number;
  readonly height: number;
  private obstacles: Map<string, Obstacle>;
  private tiles: Map<string, Tile> = new Map();

  constructor(config: BoardConfig) {
    this.width = config.width;
    this.height = config.height;
    this.obstacles = new Map();
    for (const obs of config.obstacles) {
      this.obstacles.set(posKey(obs.pos), { ...obs });
    }
  }

  inBounds(pos: Pos): boolean {
    return pos.x >= 0 && pos.x < this.width && pos.y >= 0 && pos.y < this.height;
  }

  isBlocked(pos: Pos): boolean {
    const obs = this.obstacles.get(posKey(pos));
    return obs !== undefined && obs.state !== 'destroyed';
  }

  getObstacle(pos: Pos): Obstacle | undefined {
    return this.obstacles.get(posKey(pos));
  }

  // Destroy an obstacle: marks it 'destroyed'. It stays on the board as rubble
  // (still rendered) but behaves like an empty, walkable tile from then on.
  destroyObstacle(pos: Pos): boolean {
    const obs = this.obstacles.get(posKey(pos));
    if (!obs || obs.state === 'destroyed') return false;
    obs.state = 'destroyed';
    return true;
  }

  // --- Tiles ---
  setTile(tile: Tile): void {
    this.tiles.set(posKey(tile.pos), { ...tile, pos: { ...tile.pos } });
  }

  getTile(pos: Pos): Tile | undefined {
    return this.tiles.get(posKey(pos));
  }

  toJSON() {
    return {
      width: this.width,
      height: this.height,
      obstacles: Array.from(this.obstacles.values()),
      tiles: Array.from(this.tiles.values()),
    };
  }
}

function posKey(pos: Pos): string {
  return `${pos.x},${pos.y}`;
}

// DnD 3.5 diagonal cost: alternating 1-2-1-2, so N diagonals cost N + floor(N/2)
export function moveCost(from: Pos, to: Pos): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const diagonals = Math.min(dx, dy);
  const straights = Math.abs(dx - dy);
  return straights + diagonals + Math.floor(diagonals / 2);
}

export function chebyshevDist(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ---- Multi-square units (anchor + size) ----
// A unit occupies a `size`×`size` block of squares whose top-left corner is its
// `pos` (the anchor). size 1 = a normal single-square unit. These helpers let the
// rest of the engine treat a unit as its footprint instead of a single point;
// every one reduces to single-cell behaviour at size 1.
export interface Footprintable { pos: Pos; size?: number; }

// The squares a unit covers. Anchored at `pos`, extending +x / +y.
export function footprint(pos: Pos, size: number): Pos[] {
  const cells: Pos[] = [];
  for (let dx = 0; dx < size; dx++)
    for (let dy = 0; dy < size; dy++)
      cells.push({ x: pos.x + dx, y: pos.y + dy });
  return cells;
}

export function cellsOf(u: Footprintable): Pos[] {
  return footprint(u.pos, u.size ?? 1);
}

// Does unit `u`'s footprint cover square `p`?
export function occupies(u: Footprintable, p: Pos): boolean {
  const size = u.size ?? 1;
  return p.x >= u.pos.x && p.x < u.pos.x + size &&
         p.y >= u.pos.y && p.y < u.pos.y + size;
}

// Reach distance between two units: the smallest range distance between any cell
// of one footprint and any cell of the other (so a melee unit against the near
// face of a big body reads as adjacent). Matches movement's diagonal cost.
export function unitDist(a: Footprintable, b: Footprintable): number {
  let best = Infinity;
  for (const ca of cellsOf(a))
    for (const cb of cellsOf(b))
      best = Math.min(best, rangeDist(ca, cb));
  return best;
}

// Range/reach distance for actions. Matches MOVEMENT's alternating 1-2-1-2
// diagonal cost (movement.ts), so targetable tiles round off the same way the
// reachable area does — a diagonal pair costs 3, not 2. dist = max + floor(min/2).
export function rangeDist(a: Pos, b: Pos): number {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
}
