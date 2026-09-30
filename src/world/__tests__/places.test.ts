import { placeAt, listPlaces, exitsFrom, inWorld, TOWN, WORLD_RADIUS } from '../places.js';
import { chunkSeed } from '../chunk.js';

// The world is a disc generated from a seed, with a handful of hand-authored
// exceptions. Two properties matter more than any particular chunk: the same
// coordinate always makes the same ground (nothing is stored, so a wobble here
// would move trees under people), and authored places keep what was authored.

describe('the shape of the world', () => {
  test('the town exists and is named', () => {
    expect(placeAt(TOWN)?.name).toBe("Sulku'it");
  });

  test('everything within the radius exists', () => {
    for (let y = -WORLD_RADIUS; y <= WORLD_RADIUS; y++) {
      for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
        expect(placeAt({ x, y })).not.toBeNull();
      }
    }
  });

  test('one step past it does not', () => {
    const out = WORLD_RADIUS + 1;
    expect(placeAt({ x: out, y: 0 })).toBeNull();
    expect(placeAt({ x: 0, y: -out })).toBeNull();
    expect(placeAt({ x: out, y: out })).toBeNull();
  });

  test('the disc is square, not a cross', () => {
    // Chebyshev: the corners are in. A Manhattan radius would have excluded them
    // and left the world a plus sign.
    expect(inWorld({ x: WORLD_RADIUS, y: WORLD_RADIUS })).toBe(true);
  });

  test('listPlaces returns exactly the disc', () => {
    const side = WORLD_RADIUS * 2 + 1;
    expect(listPlaces()).toHaveLength(side * side);
  });
});

describe('generated ground', () => {
  test('the same coordinate always makes the same place', () => {
    // Nothing is persisted, so this IS the persistence: a change here would move
    // the trees under anybody standing among them.
    const a = placeAt({ x: -1, y: 1 });
    const b = placeAt({ x: -1, y: 1 });
    expect(a).toEqual(b);
  });

  test('neighbours do not come out identical', () => {
    const seen = new Set<string>();
    for (let y = -WORLD_RADIUS; y <= WORLD_RADIUS; y++) {
      for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x++) {
        if (x === 0 && y === 0) continue;                 // the town is authored
        seen.add(`${placeAt({ x, y })!.dirt}|${placeAt({ x, y })!.obstacles}`);
      }
    }
    // Eight chunks; at least a few distinct results, or the seed is not mixing.
    expect(seen.size).toBeGreaterThan(3);
  });

  test('its knobs are inside sane ranges', () => {
    for (const p of listPlaces()) {
      expect(p.dirt).toBeGreaterThanOrEqual(0);
      expect(p.dirt).toBeLessThanOrEqual(1);
      expect(p.obstacles).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(p.obstacles)).toBe(true);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  test('a generated name says where it is', () => {
    expect(placeAt({ x: 0, y: -1 })!.name).toContain('north');
    expect(placeAt({ x: -1, y: 0 })!.name).toContain('west');
    expect(placeAt({ x: 1, y: 1 })!.name).toContain('south');
  });

  test('chunkSeed mixes rather than aliasing', () => {
    // A naive seed + x*1000 + y collides for distant pairs and produces visibly
    // identical terrain in two places.
    const seeds = new Set<number>();
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) seeds.add(chunkSeed({ x, y }));
    expect(seeds.size).toBe(49);
  });
});

describe('authored places win', () => {
  test('the town keeps its hand-set knobs rather than generated ones', () => {
    const town = placeAt(TOWN)!;
    // Deliberately empty: the town is built by placing things, so the generator
    // lays ground and gets out of the way.
    expect(town.dirt).toBe(0);
    expect(town.obstacles).toBe(0);
  });

  test('the forest keeps its own', () => {
    const forest = placeAt({ x: 1, y: 0 })!;
    expect(forest.name).toBe('Sulkupa Forest');
    expect(forest.obstacles).toBe(34);
  });
});

describe('exits', () => {
  test('the town has four, since all its neighbours exist', () => {
    expect(exitsFrom(TOWN)).toHaveLength(4);
  });

  test('a corner has only the two that lead inward', () => {
    const corner = { x: WORLD_RADIUS, y: WORLD_RADIUS };
    expect(exitsFrom(corner)).toHaveLength(2);
  });

  test('an exit never points at itself', () => {
    for (const p of listPlaces()) {
      for (const e of exitsFrom({ x: p.x, y: p.y })) {
        expect(`${e.x},${e.y}`).not.toBe(`${p.x},${p.y}`);
      }
    }
  });

  test('exits are orthogonal only, so a corner is not a doorway', () => {
    for (const e of exitsFrom(TOWN)) {
      expect(Math.abs(e.x) + Math.abs(e.y)).toBe(1);
    }
  });
});
