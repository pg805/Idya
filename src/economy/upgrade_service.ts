// Cumulative upgrade budget per weapon, indexed by profession level 0–10.
// Level 7 unlocks tier-3 material crafting but grants no additional budget.
const UPGRADE_BUDGET: readonly number[] = [0, 0, 0, 0, 3, 7, 12, 12, 18, 25, 35];

export type Profession = 'lumberjack' | 'blacksmith' | 'enchanter';

// Tier-2 and tier-3 upgrade materials per profession.
// Upgrades 1–12 cost tier-2; upgrades 13–35 cost tier-3.
const TIER2: Record<Profession, string> = {
    lumberjack: 'treated_sulwood',
    blacksmith: 'talamite',
    enchanter:  'enchanting_reagent',    // TBD
};

const TIER3: Record<Profession, string> = {
    lumberjack: 'hardwood',
    blacksmith: 'alloy',
    enchanter:  'refined_enchanting_reagent',  // TBD
};

// Hybrid weapons have a wood handle (LJ) and metal head (BS) — both professions can upgrade them.
const HYBRID_WEAPONS = new Set(['sword_talamite', 'axe_talamite', 'shovel_talamite']);

const SINGLE_PROFESSION: Record<string, Profession> = {
    quarterstaff:  'lumberjack',
    bow:           'lumberjack',
    sword_wood:    'lumberjack',
    axe_wood:      'lumberjack',
    shovel_wood:   'lumberjack',
    dagger:        'blacksmith',
    mace:          'blacksmith',
    spellbook:     'enchanter',
    kustaff:       'enchanter',
    wand:          'enchanter',
    wand_talamite: 'enchanter',
    deck_of_cards: 'enchanter',
    mental_cage:   'enchanter',
};

// All professions that can upgrade a given weapon.
export function weaponUpgradeProfessions(weaponKey: string): Profession[] {
    if (HYBRID_WEAPONS.has(weaponKey)) return ['lumberjack', 'blacksmith'];
    return [SINGLE_PROFESSION[weaponKey] ?? 'lumberjack'];
}

export function budgetForLevel(level: number): number {
    return UPGRADE_BUDGET[Math.min(Math.max(level, 0), 10)] ?? 0;
}

// Upgrade N (1-indexed) costs N tier-2 material if N ≤ 12,
// or (N - 10) tier-3 material if N ≥ 13 (so upgrade 13 → 3 units, 35 → 25 units).
export function upgradeCost(n: number, profession: Profession): { quantity: number; material: string } {
    if (n <= 12) return { quantity: n, material: TIER2[profession] };
    return { quantity: n - 10, material: TIER3[profession] };
}

// Player upgrades are stored nested by profession: { lumberjack: { Slash: [...] }, blacksmith: { ... } }
// Old flat format ({ Slash: [...] }) is migrated on read to the weapon's primary profession.
export function normalizePlayerUpgrades(
    raw: unknown,
    primaryProfession: Profession,
): Partial<Record<Profession, Record<string, number | number[]>>> {
    if (!raw || typeof raw !== 'object') return {};
    const vals = Object.values(raw as object);
    if (vals.length === 0) return {};
    // Old flat format: values are numbers or arrays directly
    if (typeof vals[0] === 'number' || Array.isArray(vals[0])) {
        return { [primaryProfession]: raw as Record<string, number | number[]> };
    }
    return raw as Partial<Record<Profession, Record<string, number | number[]>>>;
}

// For a field action, one upgrade = exactly field.length points distributed.
export function fieldUpgradeCount(delta: number[], fieldLen: number): number {
    if (fieldLen === 0) return 0;
    return Math.floor(delta.reduce((a, b) => a + b, 0) / fieldLen);
}

// Total player-applied upgrade count for a single profession's deltas.
export function totalUpgradesUsed(
    playerDeltas: Record<string, number | number[]>,
    actionFieldLens: Map<string, number>,
): number {
    let count = 0;
    for (const [name, delta] of Object.entries(playerDeltas)) {
        if (typeof delta === 'number') {
            count += delta;
        } else {
            count += fieldUpgradeCount(delta, actionFieldLens.get(name) ?? delta.length);
        }
    }
    return count;
}

// The shared upgrade cap for a weapon — max across all valid profession budgets.
// Both professions on a hybrid weapon contribute to this single pool.
export function weaponUpgradeCap(professionBudgets: number[]): number {
    return professionBudgets.length === 0 ? 0 : Math.max(...professionBudgets);
}

// Total upgrades applied to the weapon across ALL professions — determines the next upgrade's cost.
export function totalUpgradesOnWeapon(
    playerUpgrades: Partial<Record<Profession, Record<string, number | number[]>>>,
    professions: Profession[],
    fieldLens: Map<string, number>,
): number {
    return professions.reduce((sum, prof) =>
        sum + totalUpgradesUsed(playerUpgrades[prof] ?? {}, fieldLens), 0);
}

// Sum player bonuses across all professions for a single field action (for effective display).
export function summedFieldBonus(
    playerUpgrades: Partial<Record<Profession, Record<string, number | number[]>>>,
    professions: Profession[],
    actionName: string,
    fieldLen: number,
): number[] {
    const result = new Array<number>(fieldLen).fill(0);
    for (const prof of professions) {
        const deltas = playerUpgrades[prof]?.[actionName];
        if (Array.isArray(deltas)) {
            for (let i = 0; i < fieldLen; i++) result[i] += deltas[i] ?? 0;
        }
    }
    return result;
}

// Sum player bonuses across all professions for a single value action.
export function summedValueBonus(
    playerUpgrades: Partial<Record<Profession, Record<string, number | number[]>>>,
    professions: Profession[],
    actionName: string,
): number {
    let total = 0;
    for (const prof of professions) {
        const delta = playerUpgrades[prof]?.[actionName];
        if (typeof delta === 'number') total += delta;
    }
    return total;
}

export type RawAction = {
    Name: string;
    Type: number;
    Field?: number[];
    Value?: number;
    Cost?: number;
    Rounds?: number;
};

export type RawWeapon = {
    Name: string;
    Description: string;
    Resource: { Name: string; Max: number };
    Defend: RawAction[];
    'Defend Crit': RawAction[];
    Attack: RawAction[];
    'Attack Crit': RawAction[];
    Special: RawAction[];
    'Special Crit': RawAction[];
};

export type UpgradeKind = 'field' | 'value' | null;

// Returns the upgrade kind for an action, or null if it cannot be upgraded.
// Resource-restore actions (Value=0, Cost<0) are not upgradeable.
export function upgradeKind(a: RawAction): UpgradeKind {
    if (a.Field && a.Field.length > 0) return 'field';
    if (a.Value !== undefined && a.Value > 0) return 'value';
    return null;
}

export function allRawActions(raw: RawWeapon): RawAction[] {
    return [
        ...(raw.Defend            ?? []),
        ...(raw['Defend Crit']    ?? []),
        ...(raw.Attack            ?? []),
        ...(raw['Attack Crit']    ?? []),
        ...(raw.Special           ?? []),
        ...(raw['Special Crit']   ?? []),
    ];
}

export const WEAPON_CATEGORIES = [
    'defend', 'defend_crit', 'attack', 'attack_crit', 'special', 'special_crit',
] as const;

export type WeaponCategory = typeof WEAPON_CATEGORIES[number];

export function actionsWithCategories(raw: RawWeapon): { category: WeaponCategory; action: RawAction }[] {
    const pairs: { category: WeaponCategory; action: RawAction }[] = [];
    const map: [WeaponCategory, RawAction[]][] = [
        ['defend',       raw.Defend            ?? []],
        ['defend_crit',  raw['Defend Crit']    ?? []],
        ['attack',       raw.Attack            ?? []],
        ['attack_crit',  raw['Attack Crit']    ?? []],
        ['special',      raw.Special           ?? []],
        ['special_crit', raw['Special Crit']   ?? []],
    ];
    for (const [cat, actions] of map) {
        for (const action of actions) pairs.push({ category: cat, action });
    }
    return pairs;
}

// Build a map from action name to field length for all field actions in a weapon.
export function buildFieldLenMap(raw: RawWeapon): Map<string, number> {
    const m = new Map<string, number>();
    for (const a of allRawActions(raw)) {
        if (a.Field && a.Field.length > 0) m.set(a.Name, a.Field.length);
    }
    return m;
}

// ---- Enchant system ----

export type EnchantKind = 'minor' | 'major';

export interface Enchant {
    kind:     EnchantKind;
    subtype:  string;
    type?:    string;  // only set for major enchants
    delta:    number | number[];
}

export type WeaponEnchants = Record<string, Enchant>;

export const ENCHANT_SLOTS = 3;
// Minor: subtype only, +1 delta. Major: type + subtype, +3 delta.
export const ENCHANT_MINOR_COST = { thuvel: 3, hiruos: 6 } as const;
export const ENCHANT_MAJOR_COST = { thuvel: 3, hiruos: 6, nodol: 9 } as const;

export const ENCHANT_CATEGORIES = ['physical', 'arcane', 'elemental'] as const;
export type EnchantCategory = typeof ENCHANT_CATEGORIES[number];

export const ENCHANT_SUBTYPES: Record<EnchantCategory, string[]> = {
    physical:  ['sharp', 'blunt'],
    arcane:    ['mental', 'force'],
    elemental: ['fire', 'water', 'earth', 'wind', 'plant'],
};

// The Damage_Type value written into the enchant for major enchants.
export const ENCHANT_DAMAGE_TYPE: Record<EnchantCategory, string> = {
    physical:  'Physical',
    arcane:    'Arcane',
    elemental: 'Elemental',
};

// Minimum enchanter level required per category and kind.
export const ENCHANT_LEVEL_REQUIRED: Record<EnchantCategory, Record<EnchantKind, number>> = {
    physical:  { minor: 4, major: 8 },
    arcane:    { minor: 5, major: 9 },
    elemental: { minor: 6, major: 10 },
};

export function enchantDelta(kind: EnchantKind): number { return kind === 'minor' ? 1 : 3; }

export function canEnchant(enchants: WeaponEnchants, actionName: string): { ok: boolean; reason?: string } {
    if (enchants[actionName]) return { ok: false, reason: 'This action is already enchanted.' };
    if (Object.keys(enchants).length >= ENCHANT_SLOTS) {
        return { ok: false, reason: `This weapon already has ${ENCHANT_SLOTS} enchants (maximum).` };
    }
    return { ok: true };
}
