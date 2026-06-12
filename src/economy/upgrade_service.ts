// Upgrades unlocked per profession rank (0–10). THREE upgrades complete a weapon
// level: R2(1)+R4(2) = L1→L2, R6(3) = L2→L3, R7(1)+R8(2) = L3→L4, R10(3) = L4→L5.
// R2/R7 are the partial (1-upgrade) ranks that ride the tier-2/tier-3 smelting
// unlocks; R9 is open. Total 12 upgrades = the full L1→L5 climb.
const UPGRADE_BUDGET: readonly number[] = [0, 0, 1, 1, 3, 3, 6, 7, 9, 9, 12];

export type Profession = 'lumberjack' | 'blacksmith' | 'enchanter';

// Tier-2 and tier-3 upgrade materials per profession.
// Upgrades 1–12 cost tier-2; upgrades 13–35 cost tier-3.
const TIER2: Record<Profession, string> = {
    lumberjack: 'treated_sulwood',
    blacksmith: 'talamite',
    enchanter:  'hiruos',
};

const TIER3: Record<Profession, string> = {
    lumberjack: 'hardwood',
    blacksmith: 'alloy',
    enchanter:  'nodol',
};

// You upgrade a weapon with the profession that CRAFTS it (one each). Mirrors the
// recipe's `profession`. Combined/hybrid weapons are crafted by a single
// profession (battle_axe → BS, kustaff → LJ, wand → EN), so they upgrade through
// that one — you can only upgrade your own profession's weapons.
const WEAPON_PROFESSION: Record<string, Profession> = {
    axe_wood:      'lumberjack',
    sword_wood:    'lumberjack',
    shovel_wood:   'lumberjack',
    kustaff:       'lumberjack',
    pickaxe:       'blacksmith',
    dagger:        'blacksmith',
    mace:          'blacksmith',
    battle_axe:    'blacksmith',
    deck_of_cards: 'enchanter',
    spellbook:     'enchanter',
    mental_cage:   'enchanter',
    wand:          'enchanter',
};

// The profession(s) that can upgrade a weapon — its crafting profession. Empty
// for an unknown weapon (not upgradeable). Kept array-shaped for callers.
export function weaponUpgradeProfessions(weaponKey: string): Profession[] {
    const p = WEAPON_PROFESSION[weaponKey];
    return p ? [p] : [];
}

export function budgetForLevel(level: number): number {
    return UPGRADE_BUDGET[Math.min(Math.max(level, 0), 10)] ?? 0;
}

// Budget/EV points the Nth upgrade (1-indexed) is worth, for a weapon of base
// (crafted) level `baseLevel`. Upgrades climb FROM the weapon's own level: an L2
// weapon's first upgrade is the L2→L3 jump (skipping L1→L2), an L3 weapon's is
// L3→L4, etc. Gap(L→L+1) = 25(L+2), split across that level's 3 upgrades — so a
// higher-base weapon's upgrades are fewer but bigger (battle_axe L3 → 42 each).
export function upgradePointValue(n: number, baseLevel: number): number {
    const fromLevel = baseLevel + Math.ceil(n / 3) - 1;
    return Math.round((25 * (fromLevel + 2)) / 3);
}

// How many upgrades a weapon can ever take — 3 per level from its base up to L5.
// L1 weapon → 12, L2 → 9, L3 → 6. (The profession rank budget gates how many of
// these are unlocked at a time.)
export function maxUpgrades(baseLevel: number): number {
    return Math.max(0, 3 * (5 - baseLevel));
}

// The Nth upgrade's split for a weapon of base level + HP ratio: total value,
// the HP it auto-adds, and the EV points the player distributes. hp + ev = value.
export function upgradeSplit(n: number, baseLevel: number, ratio: number): { value: number; hp: number; ev: number } {
    const value = upgradePointValue(n, baseLevel);
    const hp = Math.round(value * ratio);
    return { value, hp, ev: value - hp };
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
    category?: string;  // physical/arcane/elemental
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
