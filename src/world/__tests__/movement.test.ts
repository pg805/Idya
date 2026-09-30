import { blockedBy, isPassable, nearestFree, findPath } from '../movement.js';
import type { Obstacle } from '../../combat/board.js';

// Passability is load-bearing twice over: it decides where a body can stand, and
// it decides whether walking off an edge lands you in the next chunk. A mistake
// here is a chunk nobody can enter, which is how the "everything froze" bug
// happened.

const obs = (...at: Array<[number, number]>): Obstacle[] =>
  at.map(([x, y]) => ({ pos: { x, y }, state: 'intact' }));

describe('blockedBy', () => {
  test('a standing obstacle blocks its square', () => {
    expect(blockedBy(obs([3, 4])).has('3,4')).toBe(true);
  });

  test('a destroyed one does not', () => {
    const felled: Obstacle[] = [{ pos: { x: 3, y: 4 }, state: 'destroyed' }];
    expect(blockedBy(felled).has('3,4')).toBe(false);
  });

  test('a placed barrel blocks', () => {
    expect(blockedBy([], [{ x: 2, y: 2, sprite: 'dec_barrel_01' }]).has('2,2')).toBe(true);
  });

  test('ground detail does not', () => {
    const walkable = ['dec_flower_01', 'ov_grass_01', 'dec_crop_grain_sprout_01', 'dec_tree_01_stump'];
    for (const sprite of walkable) {
      expect(blockedBy([], [{ x: 2, y: 2, sprite }]).has('2,2')).toBe(false);
    }
  });

  test('a building blocks its whole footprint, upward', () => {
    // Two by two, and the entry is the BASE, so it occupies the rows above it.
    const b = blockedBy([], [{ x: 5, y: 9, sprite: 'bld_house_01' }]);
    expect(b.has('5,9')).toBe(true);
    expect(b.has('6,9')).toBe(true);
    expect(b.has('5,8')).toBe(true);
    expect(b.has('6,8')).toBe(true);
    expect(b.has('5,7')).toBe(false);
  });

  test("a tree's canopy does not block — you walk under branches", () => {
    // The stack is drawn upward from the base; only the base is solid.
    const b = blockedBy([], [{
      x: 4, y: 10, sprite: 'dec_tree_01_bottom',
      stack: ['dec_tree_01_bottom', 'dec_tree_01_middle_01', 'dec_tree_01_top_01'],
    }]);
    expect(b.has('4,10')).toBe(true);
    expect(b.has('4,9')).toBe(false);
    expect(b.has('4,8')).toBe(false);
  });

  test('a creature DOES block — you cannot walk through a bird', () => {
    // This was briefly the other way round, to stop a spawn on a chunk's
    // arrival tile making it unenterable. Solid is the behaviour that was
    // wanted, and the arrival problem is handled where it belongs instead:
    // EDGE_BAND keeps spawns off the seam, and a crossing falls back to
    // nearestFree rather than refusing.
    const b = blockedBy([], [{ x: 0, y: 5, sprite: 'penguin', kind: 'enemy' }]);
    expect(b.has('0,5')).toBe(true);
  });
});

describe('isPassable', () => {
  const blocked = new Set(['4,4']);
  test('an open square is', () => expect(isPassable({ x: 1, y: 1 }, blocked)).toBe(true));
  test('a blocked one is not', () => expect(isPassable({ x: 4, y: 4 }, blocked)).toBe(false));
  test('off the board is not', () => {
    expect(isPassable({ x: -1, y: 1 }, blocked)).toBe(false);
    expect(isPassable({ x: 24, y: 1 }, blocked)).toBe(false);
    expect(isPassable({ x: 1, y: -1 }, blocked)).toBe(false);
  });
});

describe('nearestFree', () => {
  test('an open square is its own answer', () => {
    expect(nearestFree({ x: 5, y: 5 }, new Set())).toEqual({ x: 5, y: 5 });
  });

  test('a blocked square nudges one over', () => {
    const at = nearestFree({ x: 5, y: 5 }, new Set(['5,5']));
    expect(at).not.toEqual({ x: 5, y: 5 });
    expect(Math.max(Math.abs(at.x - 5), Math.abs(at.y - 5))).toBe(1);
  });

  test('it searches outward, not just one ring', () => {
    // Everything within one ring is taken, so the answer has to be two out.
    const walled = new Set<string>();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) walled.add(`${5 + dx},${5 + dy}`);
    const at = nearestFree({ x: 5, y: 5 }, walled);
    expect(walled.has(`${at.x},${at.y}`)).toBe(false);
    expect(Math.max(Math.abs(at.x - 5), Math.abs(at.y - 5))).toBe(2);
  });

  test('nowhere to stand gives back where you were, rather than hanging', () => {
    const solid = new Set<string>();
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) solid.add(`${x},${y}`);
    expect(nearestFree({ x: 5, y: 5 }, solid)).toEqual({ x: 5, y: 5 });
  });
});

describe('findPath', () => {
  test('a clear run is a straight line', () => {
    const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, new Set());
    expect(path).not.toBeNull();
    expect(path).toHaveLength(3);
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 0 });
  });

  test('the start square is excluded and the destination included', () => {
    const path = findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, new Set())!;
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });

  test('standing still is an empty path, not null', () => {
    expect(findPath({ x: 2, y: 2 }, { x: 2, y: 2 }, new Set())).toEqual([]);
  });

  test('it routes around an obstacle', () => {
    const path = findPath({ x: 0, y: 1 }, { x: 2, y: 1 }, new Set(['1,1']))!;
    expect(path).not.toBeNull();
    expect(path.some(p => p.x === 1 && p.y === 1)).toBe(false);
  });

  test('a wall with a gap is routed through it', () => {
    // Blocks the whole column except y=5, so the only way across is the gap.
    const leaky = new Set<string>();
    for (let y = 0; y < 24; y++) if (y !== 5) leaky.add(`1,${y}`);
    const path = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, leaky)!;
    expect(path).not.toBeNull();
    expect(path.some(p => p.x === 1 && p.y === 5)).toBe(true);
  });

  test('a sealed destination is null', () => {
    // The full column, so there is no gap and no way round: the board edge is
    // the rest of the wall.
    const sealed = new Set<string>();
    for (let y = 0; y < 24; y++) sealed.add(`1,${y}`);
    expect(findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, sealed)).toBeNull();
  });

  test('a destination inside a wall is null', () => {
    expect(findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, new Set(['1,1']))).toBeNull();
  });

  test('a diagonal may not squeeze between two blocked squares', () => {
    // Going (0,0) -> (1,1) with both orthogonal neighbours blocked has to fail
    // rather than slipping through the join, or people walk through walls.
    const pinched = new Set(['1,0', '0,1']);
    const path = findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, pinched);
    expect(path).toBeNull();
  });

  test('but one open side is enough', () => {
    const path = findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, new Set(['1,0']));
    expect(path).toEqual([{ x: 1, y: 1 }]);
  });
});
