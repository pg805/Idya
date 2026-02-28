export enum Stance {
    Defensive  = 'D',
    Balanced   = 'B',
    Aggressive = 'A'
}

export enum RollMode {
    Ld2 = 'Ld2',   // roll 2 dice, take lowest
    One = '1d',    // roll 1 die (baseline)
    Hd2 = 'Hd2',   // roll 2 dice, take highest
    Hd4 = 'Hd4'    // roll 4 dice, take highest
}

export const stance_label: Record<Stance, string> = {
    [Stance.Defensive]:  'Defensive',
    [Stance.Balanced]:   'Balanced',
    [Stance.Aggressive]: 'Aggressive'
}

/**
 * Returns the roll mode to use when attacker damages defender,
 * accounting for both raw stance effects and counter interactions:
 *
 *   D counters A  → both roll Ld2
 *   N counters D  → both roll 1d
 *   A counters N  → A rolls Hd4, N rolls Ld2
 *   Mirror match  → each uses their own stance's default
 */
export function resolve_roll_mode(attacker_stance: Stance, defender_stance: Stance): RollMode {
    // D vs A matchup (either direction) → both Ld2
    if (
        (attacker_stance === Stance.Aggressive && defender_stance === Stance.Defensive) ||
        (attacker_stance === Stance.Defensive  && defender_stance === Stance.Aggressive)
    ) {
        return RollMode.Ld2;
    }

    // N vs D matchup (either direction) → both 1d
    if (
        (attacker_stance === Stance.Balanced  && defender_stance === Stance.Defensive) ||
        (attacker_stance === Stance.Defensive && defender_stance === Stance.Balanced)
    ) {
        return RollMode.One;
    }

    // A vs N matchup
    if (attacker_stance === Stance.Aggressive && defender_stance === Stance.Balanced)  return RollMode.Hd4;
    if (attacker_stance === Stance.Balanced   && defender_stance === Stance.Aggressive) return RollMode.Ld2;

    // Mirror matches
    if (attacker_stance === Stance.Aggressive) return RollMode.Hd4;
    if (attacker_stance === Stance.Defensive)  return RollMode.Ld2;

    return RollMode.One;
}
