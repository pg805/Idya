import { Combatant } from './combat_session.js';

// DnD-style initiative. Each combatant rolls 1..100 minus their weight; higher
// goes first. Ties:
//   1. Player beats NPC.
//   2. Otherwise, coin flip.
// Roll once per battle (current rule) and assign deterministic ranks 0..N-1.
//
// Effect of weight: heavier weapons go later. Weight 0 = no penalty (current
// default for every weapon and enemy until per-weapon weights are tuned).

export function rollInitiativeScore(weight: number): number {
  return Math.floor(Math.random() * 100) + 1 - weight;
}

// Mutates each combatant, setting .initiative and .initiativeRank.
// Returns log lines describing the rolls + final order.
export function assignInitiative(combatants: Combatant[]): string[] {
  for (const c of combatants) {
    c.initiative = rollInitiativeScore(c.weight);
  }
  const sorted = [...combatants].sort((a, b) => {
    if (a.initiative !== b.initiative) return b.initiative - a.initiative;
    // Tie: player beats NPC. Player has isAI=false.
    if (a.isAI !== b.isAI) return a.isAI ? 1 : -1;
    // Still tied (both player or both NPC). Coin flip.
    return Math.random() < 0.5 ? -1 : 1;
  });
  sorted.forEach((c, i) => { c.initiativeRank = i; });

  const parts = sorted.map(c => `${c.name} ${c.initiative}`);
  return [`Initiative — ${parts.join(', ')}`];
}
