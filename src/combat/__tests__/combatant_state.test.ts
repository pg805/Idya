import { CombatantState } from '../combatant_state.js';
import Action from '../../weapon/action.js';
import { RollMode } from '../../infrastructure/roll_mode.js';

function makeAction(damageType: string, damageSubtype: string): Action {
  const a = new Action('Test', 'Test');
  a.damage_type    = damageType;
  a.damage_subtype = damageSubtype;
  return a;
}

function makeState(resistances: Record<string, number> = {}) {
  return new CombatantState('Tester', 100, 'Integrity', 10, resistances);
}

// ---- get_roll_mode ----

describe('CombatantState.get_roll_mode', () => {
  test('no matching resistances → One (neutral)', () => {
    const state = makeState({});
    expect(state.get_roll_mode(makeAction('Physical', 'Blunt'))).toBe(RollMode.One);
  });

  test('type score > 1 (weakness) → Hd4', () => {
    const state = makeState({ Physical: 1.5 });
    expect(state.get_roll_mode(makeAction('Physical', 'Blunt'))).toBe(RollMode.Hd4);
  });

  test('type score < 1 (resist) → Ld2', () => {
    const state = makeState({ Arcane: 0.5 });
    expect(state.get_roll_mode(makeAction('Arcane', 'Mental'))).toBe(RollMode.Ld2);
  });

  test('type and subtype both present, scores multiply', () => {
    // 1.5 × 1.5 = 2.25 → weakness
    const state = makeState({ Arcane: 1.5, Mental: 1.5 });
    expect(state.get_roll_mode(makeAction('Arcane', 'Mental'))).toBe(RollMode.Hd4);
  });

  test('weakness × resist can cancel to neutral', () => {
    // 0.8 × 1.25 = 1.0 → neutral
    const state = makeState({ Physical: 0.8, Blunt: 1.25 });
    expect(state.get_roll_mode(makeAction('Physical', 'Blunt'))).toBe(RollMode.One);
  });

  test('only subtype matched → uses subtype score', () => {
    const state = makeState({ Poison: 0.6 });
    expect(state.get_roll_mode(makeAction('Elemental', 'Poison'))).toBe(RollMode.Ld2);
  });
});

// ---- apply_cost ----

describe('CombatantState.apply_cost', () => {
  test('deducts cost from resource', () => {
    const state = makeState();
    const a = new Action('Swing', ''); a.cost = 3;
    state.apply_cost(a);
    expect(state.resource_current).toBe(7);
  });

  test('zero cost does nothing and returns empty string', () => {
    const state = makeState();
    const a = new Action('Free', ''); a.cost = 0;
    const result = state.apply_cost(a);
    expect(result).toBe('');
    expect(state.resource_current).toBe(10);
  });

  test('cost exceeding resource clamps to 0', () => {
    const state = makeState();
    const a = new Action('Big', ''); a.cost = 50;
    state.apply_cost(a);
    expect(state.resource_current).toBe(0);
  });

  test('negative cost (regen) adds resource, capped at max', () => {
    const state = makeState();
    state.resource_current = 5;
    const a = new Action('Rest', ''); a.cost = -6;
    state.apply_cost(a);
    expect(state.resource_current).toBe(10); // capped at max
  });
});

// ---- end_round ----

describe('CombatantState.end_round', () => {
  test('block resets to 0', () => {
    const state = makeState(); state.block = 15;
    state.end_round();
    expect(state.block).toBe(0);
  });

  test('active DOT deals damage and decrements rounds', () => {
    const state = makeState(); state.dot = { value: 10, rounds: 3 };
    state.end_round();
    expect(state.health).toBe(90);
    expect(state.dot.rounds).toBe(2);
  });

  test('DOT on last round clears value and rounds', () => {
    const state = makeState(); state.dot = { value: 5, rounds: 1 };
    state.end_round();
    expect(state.health).toBe(95);
    expect(state.dot.rounds).toBe(0);
    expect(state.dot.value).toBe(0);
  });

  test('DOT cannot reduce health below 0', () => {
    const state = makeState(); state.dot = { value: 200, rounds: 1 };
    state.end_round();
    expect(state.health).toBe(0);
  });

  test('no DOT → health unchanged', () => {
    const state = makeState();
    state.end_round();
    expect(state.health).toBe(100);
  });
});
