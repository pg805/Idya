import { chooseSlot, isChestSprite, CHEST_SLOTS, CHEST_COLS } from '../chests.js';

// chooseSlot is the only decision in putInChest; everything else around it is
// writes. The behaviour that matters is that stacking beats finding an empty
// slot, so depositing the same thing twice reads as one action instead of
// scattering it across the grid.

const at = (...pairs: Array<[number, string]>) =>
  pairs.map(([slot, item_id]) => ({ slot, item_id }));

describe('the shape of a chest', () => {
  test('twelve slots, two rows of six', () => {
    expect(CHEST_SLOTS).toBe(12);
    expect(CHEST_COLS).toBe(6);
    expect(CHEST_SLOTS % CHEST_COLS).toBe(0);
  });
});

describe('isChestSprite', () => {
  test('recognises a chest', () => expect(isChestSprite('obj_chest_01')).toBe(true));
  test('and a later one, unnamed today', () => expect(isChestSprite('obj_chest_99')).toBe(true));
  test('not a barrel', () => expect(isChestSprite('dec_barrel_01')).toBe(false));
  test('not a tree', () => expect(isChestSprite('dec_tree_01_bottom')).toBe(false));
});

describe('chooseSlot, with no slot asked for', () => {
  test('an empty chest takes the first slot', () => {
    expect(chooseSlot([], 'sulwood')).toEqual({ slot: 0 });
  });

  test('it stacks onto the same item rather than opening a new slot', () => {
    // The point: slot 0 is taken by the same thing, and slots 1-11 are free, and
    // it still goes to 0.
    expect(chooseSlot(at([0, 'sulwood']), 'sulwood')).toEqual({ slot: 0 });
  });

  test('it stacks even when the stack is late in the grid', () => {
    expect(chooseSlot(at([0, 'talamite'], [7, 'sulwood']), 'sulwood')).toEqual({ slot: 7 });
  });

  test('a different item takes the first gap, not the end', () => {
    expect(chooseSlot(at([0, 'talamite'], [2, 'thuvel']), 'sulwood')).toEqual({ slot: 1 });
  });

  test('a full chest refuses', () => {
    const full = at(...Array.from({ length: CHEST_SLOTS }, (_, i) => [i, `thing_${i}`] as [number, string]));
    expect(chooseSlot(full, 'sulwood')).toEqual({ why: 'The chest is full.' });
  });

  test('a full chest still takes more of something already in it', () => {
    // Stacking is checked before space, which is what makes this work — and it
    // is the behaviour you want, since the grid is not getting any fuller.
    const full = at(...Array.from({ length: CHEST_SLOTS }, (_, i) => [i, `thing_${i}`] as [number, string]));
    expect(chooseSlot(full, 'thing_5')).toEqual({ slot: 5 });
  });
});

describe('chooseSlot, with a slot asked for', () => {
  test('an empty slot is given', () => {
    expect(chooseSlot([], 'sulwood', 4)).toEqual({ slot: 4 });
  });

  test('a slot holding the same item is given, to stack', () => {
    expect(chooseSlot(at([4, 'sulwood']), 'sulwood', 4)).toEqual({ slot: 4 });
  });

  test('a slot holding something else is refused', () => {
    expect(chooseSlot(at([4, 'talamite']), 'sulwood', 4))
      .toEqual({ why: 'Something else is in that slot.' });
  });

  test('a slot outside the grid is refused', () => {
    expect(chooseSlot([], 'sulwood', -1)).toEqual({ why: 'No such slot.' });
    expect(chooseSlot([], 'sulwood', CHEST_SLOTS)).toEqual({ why: 'No such slot.' });
    expect(chooseSlot([], 'sulwood', 1.5)).toEqual({ why: 'No such slot.' });
  });

  test('asking for slot 0 is not mistaken for asking for nothing', () => {
    // Zero is falsy, so a truthiness check here would silently fall through to
    // the automatic path and put it somewhere else.
    expect(chooseSlot(at([0, 'talamite']), 'sulwood', 0))
      .toEqual({ why: 'Something else is in that slot.' });
  });
});
