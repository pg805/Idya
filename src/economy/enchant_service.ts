// Enchant system (0.2.0 rework) — a power layer SEPARATE from the upgrade system.
// A weapon has ENCHANT_SLOTS slots; each enchant takes one. Four types, each
// applied once per weapon (the 'upgrade' enchant is once per ABILITY, so several
// can coexist, each taking a slot):
//   health  — flat HP by weapon level
//   melee   — adds the Sidaev Strike ability (Arcane/Blunt, range 1)
//   ranged  — adds the Sidaev Pulse  ability (Arcane/Sharp, range 2)
//   upgrade — adds a set EV to one ability + an optional damage-type change
// Every value scales off the level budget CAP(L) and is static within a level.
import Strike from '../weapon/action/strike.js';
import Result_Field from '../infrastructure/result_field.js';
import type Action from '../weapon/action.js';

export const ENCHANT_SLOTS = 3;

export type EnchantType = 'health' | 'melee' | 'ranged' | 'upgrade';

export interface WeaponEnchant {
    type:            EnchantType;
    action?:         string;              // 'upgrade': which ability is targeted
    delta?:          number | number[];   // 'upgrade': EV bonus (value action) or distribution (field action)
    damage_type?:    string;              // 'upgrade': optional retype
    damage_subtype?: string;
}

// Keyed by slot id: 'health' | 'melee' | 'ranged' | `upgrade:<action>`.
export type WeaponEnchants = Record<string, WeaponEnchant>;

const CAP = (lvl: number): number => 25 * lvl * (lvl + 3) / 2;           // 50/125/225/350/500
const clampLvl = (lvl: number): number => Math.max(1, Math.min(5, lvl));

// ── per-level value tables (% of CAP; the tunable knobs) ──
export function enchantHealthHp(lvl: number): number { return Math.round(0.25 * CAP(clampLvl(lvl))); }    // 13/31/56/88/125
export function upgradeEnchantEv(lvl: number): number { return Math.round(0.06 * CAP(clampLvl(lvl))); }   // 3/8/14/21/30

// Sidaev ability fields by weapon level (EV ≈ 5%·CAP melee, 3.5%·CAP ranged; melee > ranged).
const MELEE_FIELDS:  Record<number, number[]> = { 1: [0, 3, 4, 5], 2: [0, 6, 8, 10], 3: [0, 12, 15, 17], 4: [0, 20, 25, 27], 5: [0, 28, 34, 38] };
const RANGED_FIELDS: Record<number, number[]> = { 1: [0, 2, 3, 3], 2: [0, 4, 6, 6],  3: [0, 9, 11, 12],  4: [0, 14, 16, 18], 5: [0, 20, 25, 27] };

export function sidaevField(type: 'melee' | 'ranged', lvl: number): number[] {
    return (type === 'melee' ? MELEE_FIELDS : RANGED_FIELDS)[clampLvl(lvl)] ?? [0, 0, 0, 0];
}

export const SIDAEV_DEF = {
    melee:  { name: 'Sidaev Strike', damage_type: 'Arcane', damage_subtype: 'Blunt', range: 1, cost: 1, action_string: '<User> channels a crushing Sidaev strike into <Target> for <Damage> damage!' },
    ranged: { name: 'Sidaev Pulse',  damage_type: 'Arcane', damage_subtype: 'Sharp', range: 2, cost: 1, action_string: '<User> looses a piercing Sidaev pulse at <Target> for <Damage> damage!' },
} as const;

// Build a live Strike action for an injected Sidaev ability at a weapon level.
// These ride in the weapon's `attack` array, so they're Attack-category for crits.
export function buildSidaevAction(type: 'melee' | 'ranged', lvl: number): Action {
    const def = SIDAEV_DEF[type];
    const a = new Strike(def.name, def.action_string, new Result_Field([...sidaevField(type, lvl)]));
    a.damage_type    = def.damage_type;
    a.damage_subtype = def.damage_subtype;
    a.cost           = def.cost;
    a.range          = def.range;
    a.aimed          = false;          // reactive single-target for now
    return a;
}

// ── retype options for the upgrade enchant (any type + any subtype) ──
export const DAMAGE_TYPES    = ['Physical', 'Arcane', 'Elemental'] as const;
export const DAMAGE_SUBTYPES = ['sharp', 'blunt', 'mental', 'force', 'fire', 'water', 'earth', 'wind', 'plant'] as const;

// ── slot bookkeeping ──
export function enchantSlotKey(type: EnchantType, action?: string): string {
    return type === 'upgrade' ? `upgrade:${action ?? ''}` : type;
}
export function enchantSlotsUsed(enchants: WeaponEnchants): number { return Object.keys(enchants).length; }
export function canAddEnchant(enchants: WeaponEnchants, type: EnchantType, action?: string): { ok: boolean; reason?: string } {
    const key = enchantSlotKey(type, action);
    if (enchants[key]) return { ok: false, reason: type === 'upgrade' ? 'This ability is already enchanted.' : 'This enchant is already applied.' };
    if (enchantSlotsUsed(enchants) >= ENCHANT_SLOTS) return { ok: false, reason: `This weapon already has ${ENCHANT_SLOTS} enchants (maximum).` };
    return { ok: true };
}

// ── cost + rank gating (PLACEHOLDER — scales with weapon level; tune alongside rank later) ──
export function enchantCost(weaponLevel: number): Record<string, number> {
    return weaponLevel >= 4 ? { nodol: weaponLevel - 2 } : { hiruos: 3 * Math.max(1, weaponLevel) };
}
export const ENCHANT_LEVEL_REQUIRED: Record<EnchantType, number> = { health: 3, melee: 3, ranged: 3, upgrade: 3 };
