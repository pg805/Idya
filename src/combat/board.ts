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
export type TileKind = 'block' | 'buff' | 'hazard';
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

  // Mark an obstacle destroyed (it no longer blocks LOS/movement).
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
