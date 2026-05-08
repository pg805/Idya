// Cumulative upgrade budget per weapon, indexed by LJ level 0–10.
// Level 7 unlocks hardwood crafting but grants no additional budget.
const UPGRADE_BUDGET: readonly number[] = [0, 0, 0, 0, 3, 7, 12, 12, 18, 25, 35];

export function budgetForLevel(ljLevel: number): number {
    return UPGRADE_BUDGET[Math.min(Math.max(ljLevel, 0), 10)] ?? 0;
}

// Upgrade N (1-indexed) costs N tier-2 material if N ≤ 12,
// or (N - 10) tier-3 material if N ≥ 13 (e.g. upgrade 13 → 3 units, 35 → 25 units).
// Currently hardcoded to LJ materials. Needs profession parameter when BS upgrades are added.
export function upgradeCost(n: number): { quantity: number; material: string } {
    if (n <= 12) return { quantity: n, material: 'treated_sulwood' };
    return { quantity: n - 10, material: 'hardwood' };
}

// For a field action, one upgrade = exactly field.length points distributed.
export function fieldUpgradeCount(delta: number[], fieldLen: number): number {
    if (fieldLen === 0) return 0;
    return Math.floor(delta.reduce((a, b) => a + b, 0) / fieldLen);
}

// Total player-applied upgrade count across all actions on a weapon.
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
