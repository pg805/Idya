// How a damage roll is shaped by a type/subtype resistance matchup. A weakness
// skews high (roll more dice, take highest), a resist skews low (take lowest),
// neutral is a single baseline roll. Mapped from resistance scores in
// CombatantState.get_roll_mode and applied in Result_Field.get_result_with_mode.
export enum RollMode {
    Ld2 = 'Ld2',   // roll 2 dice, take lowest (resist)
    One = '1d',    // roll 1 die (neutral baseline)
    Hd2 = 'Hd2',   // roll 2 dice, take highest
    Hd4 = 'Hd4'    // roll 4 dice, take highest (weakness)
}
