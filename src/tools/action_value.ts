// Realized per-action value, measured from the actual battle loop.
//
// Budget theory says "1 budget = 1 expected damage". This tool checks that
// against reality: it runs Branch vs each enemy, and for every action records
// what it ACTUALLY did — damage dealt for strikes, damage actually prevented for
// blocks / shields / debuffs (capped by the real roll, and only on turns the
// opponent strikes). Compare the "Realized/use" column to the "Budget" column to
// see where the formula over- or under-charges.
//
//   node ./lib/tools/action_value.js            # aggregate tables
//   node ./lib/tools/action_value.js --trace     # + one sample battle, step by step

import logger from '../utility/logger.js';
for (const t of logger.transports) (t as any).silent = true;

import { CombatantState } from '../combat/combatant_state.js';
import { ActionType } from '../weapon/action.js';
import Action from '../weapon/action.js';
import { RollMode } from '../infrastructure/stance.js';
import Weapon from '../weapon/weapon.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEAPONS_DIR = join(__dirname, '../../database/weapons');
const ENEMIES_DIR = join(__dirname, '../../database/enemies');
const MAX_ROUNDS = 80;
const N = 20_000;
const AIM_HIT_CHANCE = 0.5;
const TRACE = process.argv.includes('--trace');

type EnemyData = { Name: string; Health: number; Level?: number; Pattern: [number, number][]; Weapon: Record<string, unknown>; Resistances?: Record<string, number> };

// ---- realized-value accumulators, keyed by "Unit::Action" ----
type Acc = { unit: string; action: string; kind: string; uses: number; realized: number };
const acc = new Map<string, Acc>();
const key = (unit: string, action: string) => `${unit}::${action}`;
function bump(unit: string, action: string, kind: string, uses: number, realized: number) {
    const k = key(unit, action);
    const a = acc.get(k) ?? { unit, action, kind, uses: 0, realized: 0 };
    a.uses += uses; a.realized += realized;
    acc.set(k, a);
}

// ---- helpers ----
const ev = (f: number[]) => f.reduce((a, b) => a + b, 0) / f.length;
const MU = 4.5;                                       // reference attack EV at L1 (≈ max_roll/2)
const prevented = (V: number) => V - (V * V) / (4 * MU);

// Budget cost per the locked 0.2.0 formula:
//   attack  = EV × range × aim          (no variance discount)
//   block   = prevented(value)
//   shield/debuff = prevented(value) × rounds × 0.5
function budgetCost(a: Action, isCrit = false): number {
    if (a.type === ActionType.Strike || a.type === ActionType.DamageOverTime) {
        const E = ev((a as any).field.field as number[]);
        const range = 1 + 0.1 * (((a as any).range ?? 1) - 1);
        const aim = isCrit ? 1.0 : (a.aimed ? 0.9 : 1.1);
        const rounds = a.type === ActionType.DamageOverTime ? (a as any).rounds : 1;
        return E * range * aim * rounds;
    }
    if (a.type === ActionType.Block) return prevented((a as any).value);
    if (a.type === ActionType.Heal) return (a as any).value;
    // Shield / Debuff / Buff / Reflect
    return prevented((a as any).value ?? 0) * ((a as any).rounds ?? 1) * 0.5;
}

// ---- choose logic (mirrors simulate.ts) ----
type Choice = { action: Action; category: 'defend' | 'attack' | 'special' };
function choosePlayer(w: Weapon, s: CombatantState): Choice {
    if (w.attack.length && w.attack[0].cost <= s.resource_current) return { action: w.attack[0], category: 'attack' };
    for (const a of [...w.defend, ...w.special]) if (a.cost < 0) return { action: a, category: w.defend.includes(a) ? 'defend' : 'special' };
    for (const a of [...w.defend, ...w.special]) if (a.cost <= s.resource_current) return { action: a, category: w.defend.includes(a) ? 'defend' : 'special' };
    return { action: w.defend[0], category: 'defend' };
}
// Turn-1 regain: combatants start ≥1 tile apart, so nobody can attack round 1.
// Both spend it regaining (restore action) or holding.
function chooseRegain(w: Weapon): Choice {
    for (const a of [...w.defend, ...w.special]) if (a.cost < 0) return { action: a, category: w.defend.includes(a) ? 'defend' : 'special' };
    return { action: w.defend[0], category: 'defend' };
}
function chooseEnemy(w: Weapon, s: CombatantState, pat: { type: number; index: number }[], idx: number): Choice & { nextIdx: number } {
    for (let i = 0; i < pat.length; i++) {
        const e = pat[(idx + i) % pat.length];
        let action: Action | null = null; let category: 'defend' | 'attack' | 'special' = 'defend';
        if (e.type === 1) { action = w.defend[e.index] ?? null; category = 'defend'; }
        if (e.type === 2) { action = w.attack[e.index] ?? null; category = 'attack'; }
        if (e.type === 3) { action = w.special[e.index] ?? null; category = 'special'; }
        if (!action) continue;
        if (action.cost > 0 && action.cost > s.resource_current) continue;
        return { action, category, nextIdx: (idx + i + 1) % pat.length };
    }
    return { action: w.defend[0], category: 'defend', nextIdx: (idx + 1) % pat.length };
}

// ---- apply one action with full attribution ----
// state carries source tags so ongoing mitigation credits the action that cast it.
function applyAction(actor: CombatantState, target: CombatantState, actorUnit: string, action: Action, trace: string[] | null, isCrit = false, count = true) {
    actor.apply_cost(action);

    if (action.type === ActionType.Strike) {
        const mode = target.get_roll_mode(action);
        const roll = (action as any).field.get_result_with_mode(mode);
        const block = target.block, shield = target.shield.value;
        const buff = actor.buff.value, debuff = actor.debuff.value;
        const offense = roll + buff - debuff;
        const damage = Math.max(offense - block - shield, 0);

        // attribute debuff prevention (debuff on actor was cast by the opponent)
        const dNoDebuff = Math.max(roll + buff - block - shield, 0);
        const debuffPrev = dNoDebuff - damage;
        if (debuffPrev > 0 && (actor as any)._debuffSrc) { const s = (actor as any)._debuffSrc; bump(s.unit, s.action, 'debuff', 0, debuffPrev); }

        // attribute block/shield prevention, split by value share
        const dNoDef = Math.max(offense, 0);
        const defPrev = dNoDef - damage;
        if (defPrev > 0 && (block + shield) > 0) {
            const bSrc = (target as any)._blockSrc, sSrc = (target as any)._shieldSrc;
            if (block > 0 && bSrc) bump(bSrc.unit, bSrc.action, 'block', 0, defPrev * block / (block + shield));
            if (shield > 0 && sSrc) bump(sSrc.unit, sSrc.action, 'shield', 0, defPrev * shield / (block + shield));
        }

        target.health = Math.max(target.health - damage, 0);
        bump(actorUnit, action.name, isCrit ? 'crit' : 'attack', 1, damage);
        trace?.push(`    ${actorUnit} ${action.name}${isCrit ? ' (CRIT)' : ''}: roll ${roll}${mode !== RollMode.One ? ` [${mode}]` : ''}${block + shield ? ` −${block + shield} def` : ''}${debuff ? ` −${debuff} debuff` : ''} → ${damage} dmg  (${target.name} ${target.health + damage}→${target.health})`);
        return;
    }
    if (action.type === ActionType.Block) {
        actor.block = (action as any).value;
        (actor as any)._blockSrc = { unit: actorUnit, action: action.name };
        if (count) bump(actorUnit, action.name, 'block', 1, 0);
        trace?.push(`    ${actorUnit} ${action.name}: block ${actor.block}${action.cost < 0 ? `, +${-action.cost} ${actor.resource_name}` : ''}`);
        return;
    }
    if (action.type === ActionType.Shield) {
        actor.shield.value = (action as any).value; actor.shield.rounds = (action as any).rounds;
        (actor as any)._shieldSrc = { unit: actorUnit, action: action.name };
        bump(actorUnit, action.name, 'shield', 1, 0);
        trace?.push(`    ${actorUnit} ${action.name}: shield ${actor.shield.value} × ${actor.shield.rounds}`);
        return;
    }
    if (action.type === ActionType.Debuff) {
        target.debuff.value = (action as any).value; target.debuff.rounds = (action as any).rounds;
        target.buff.value = 0; target.buff.rounds = 0;
        (target as any)._debuffSrc = { unit: actorUnit, action: action.name };
        bump(actorUnit, action.name, 'debuff', 1, 0);
        trace?.push(`    ${actorUnit} ${action.name}: debuff ${target.debuff.value} × ${target.debuff.rounds} on ${target.name}`);
        return;
    }
    if (action.type === ActionType.DamageOverTime) {
        const mode = target.get_roll_mode(action);
        const dmg = (action as any).field.get_result_with_mode(mode);
        target.dot.value = dmg; target.dot.rounds = (action as any).rounds;
        (target as any)._dotSrc = { unit: actorUnit, action: action.name };
        bump(actorUnit, action.name, 'dot', 1, 0);
        return;
    }
    if (action.type === ActionType.Buff) {
        target.buff.value = (action as any).value; target.buff.rounds = (action as any).rounds;
        target.debuff.value = 0; target.debuff.rounds = 0;
        bump(actorUnit, action.name, 'buff', 1, 0);
        return;
    }
    if (action.type === ActionType.Heal) {
        const before = target.health; target.health = Math.min(target.health + (action as any).value, target.max_health);
        bump(actorUnit, action.name, 'heal', 1, target.health - before);
        return;
    }
}

// end-of-round: DOT ticks (credit source), reset block, decrement effects
function endRound(s: CombatantState) {
    if (s.dot.rounds > 0 && s.dot.value > 0) {
        const dmg = Math.min(s.dot.value, s.health);
        if ((s as any)._dotSrc) { const src = (s as any)._dotSrc; bump(src.unit, src.action, 'dot', 0, dmg); }
    }
    if (s.block > 0) (s as any)._blockSrc = null;
    s.end_round();
}

const aimedHits = (a: Action) => !a.aimed || Math.random() < AIM_HIT_CHANCE;
const initScore = (weight: number) => Math.floor(Math.random() * 100) + 1 - weight;

// One side's per-round picture. `unit` is the accumulator label.
type Side = { unit: string; self: CombatantState; foe: CombatantState; choice: Choice; hits: boolean; crit: Action | null; foeChoice: Choice };

// Mirrors resolution.ts: action phase runs defend → attack → special, each in
// initiative order. All defends go up before any attack lands, so blocks work
// for both sides. Crit fires after the main attack when the target's intent is
// a special. Initiative is rolled once per battle (1d100 − weight; player wins ties).
function runBattle(pW: Weapon, eData: EnemyData, trace: string[] | null): 'player' | 'enemy' | 'timeout' {
    const player = new CombatantState(pW.name, pW.hp || 50, pW.resource_name, pW.resource_max);
    const eW = Weapon.from_json(eData.Weapon as any);
    const enemy = new CombatantState(eData.Name, eData.Health, eW.resource_name, eW.resource_max, eData.Resistances ?? {});
    const pat = (eData.Pattern ?? []).map(([type, index]) => ({ type, index }));
    let eIdx = 0;

    // player wins the tie (>=)
    const playerFirst = initScore((pW as any).weight ?? 0) >= initScore((eW as any).weight ?? 0);

    for (let round = 0; round < MAX_ROUNDS; round++) {
        // Round 0 is the approach: both regain, enemy pattern does not advance.
        const pc = round === 0 ? chooseRegain(pW) : choosePlayer(pW, player);
        let ec: Choice;
        if (round === 0) { ec = chooseRegain(eW); }
        else { const r = chooseEnemy(eW, enemy, pat, eIdx); eIdx = r.nextIdx; ec = r; }
        const pSide: Side = { unit: pW.name, self: player, foe: enemy, choice: pc, hits: aimedHits(pc.action), crit: pW.attack_crit[0] ?? null, foeChoice: ec };
        const eSide: Side = { unit: eData.Name, self: enemy, foe: player, choice: ec, hits: aimedHits(ec.action), crit: eW.attack_crit[0] ?? null, foeChoice: pc };
        const order = playerFirst ? [pSide, eSide] : [eSide, pSide];
        trace?.push(`  R${round + 1}  [${player.name} ${player.health}hp / ${enemy.name} ${enemy.health}hp]${round === 0 ? `  (${playerFirst ? player.name : enemy.name} has initiative)` : ''}`);

        // Action phase: defend → attack → special, initiative order within each.
        for (const phase of ['defend', 'attack', 'special'] as const) {
            for (const s of order) {
                if (s.choice.category !== phase) continue;
                if (s.self.health <= 0 || s.foe.health <= 0) continue;
                if (!s.hits) { s.self.apply_cost(s.choice.action); trace?.push(`    ${s.unit} ${s.choice.action.name}: MISS (aim)`); continue; }
                applyAction(s.self, s.foe, s.unit, s.choice.action, trace, false, round !== 0);
                // crit fires after the main attack when the target intended a special
                if (phase === 'attack' && s.crit && s.foeChoice.category === 'special' && s.foe.health > 0) {
                    applyAction(s.self, s.foe, s.unit, s.crit, trace, true);
                }
                if (s.foe.health <= 0) { trace?.push(`    → ${s.foe.name} down`); return s.foe === enemy ? 'player' : 'enemy'; }
            }
        }

        // End of round: tick DOT / decrement effects in initiative order.
        for (const s of order) {
            endRound(s.self);
            if (s.self.health <= 0) { trace?.push(`    → ${s.self.name} down (DOT)`); return s.self === enemy ? 'player' : 'enemy'; }
        }
    }
    return 'timeout';
}

// ---- load ----
const branchW = Weapon.from_file(join(WEAPONS_DIR, 'branch.yaml'));
const loadEnemy = (f: string) => yaml.load(fs.readFileSync(join(ENEMIES_DIR, f), 'utf-8')) as EnemyData;
const enemies = [loadEnemy('lithkem_swallow.yaml'), loadEnemy('tinpul.yaml')];

// ---- trace one battle ----
if (TRACE) {
    const t: string[] = [];
    const r = runBattle(branchW, enemies[0], t);
    console.log(`\n=== Sample battle: Branch vs ${enemies[0].Name}  →  ${r} ===`);
    console.log(t.join('\n'));
    acc.clear(); // don't let the trace battle pollute aggregates
}

// ---- aggregate ----
const wins: Record<string, number> = {};
for (const e of enemies) {
    let w = 0;
    for (let i = 0; i < N; i++) if (runBattle(branchW, e, null) === 'player') w++;
    wins[e.Name] = w / N;
}

// ---- collect each unit's action set + crit + the budget cost ----
const actionsOf = (unit: string): { name: string; kind: string; cost: number }[] => {
    const out: { name: string; kind: string; cost: number }[] = [];
    if (unit === branchW.name) {
        for (const a of branchW.defend) out.push({ name: a.name, kind: 'block', cost: budgetCost(a) });
        for (const a of branchW.attack) out.push({ name: a.name, kind: 'attack', cost: budgetCost(a) });
        for (const a of branchW.special) out.push({ name: a.name, kind: a.type === ActionType.Strike ? 'attack' : 'special', cost: budgetCost(a) });
        for (const a of branchW.attack_crit) out.push({ name: a.name, kind: 'crit', cost: budgetCost(a, true) });
    } else {
        const e = enemies.find(x => x.Name === unit)!;
        const w = Weapon.from_json(e.Weapon as any);
        for (const a of w.defend) out.push({ name: a.name, kind: a.type === ActionType.Block ? 'block' : 'defend', cost: budgetCost(a) });
        for (const a of w.attack) out.push({ name: a.name, kind: 'attack', cost: budgetCost(a) });
        for (const a of w.special) out.push({ name: a.name, kind: a.type === ActionType.Strike ? 'attack' : 'special', cost: budgetCost(a) });
        for (const a of w.attack_crit) out.push({ name: a.name, kind: 'crit', cost: budgetCost(a, true) });
    }
    return out;
};

function table(unit: string) {
    console.log(`\n--- ${unit} ---`);
    console.log(`${'Action'.padEnd(20)}${'Kind'.padEnd(8)}${'Uses'.padStart(8)}${'Realized/use'.padStart(14)}${'Budget'.padStart(9)}${'  Δ (real−budget)'}`);
    for (const a of actionsOf(unit)) {
        const r = acc.get(key(unit, a.name));
        const perUse = r && r.uses ? r.realized / r.uses : 0;
        const delta = perUse - a.cost;
        console.log(`${a.name.padEnd(20)}${a.kind.padEnd(8)}${(r?.uses ?? 0).toLocaleString().padStart(8)}${perUse.toFixed(2).padStart(14)}${a.cost.toFixed(2).padStart(9)}${(delta >= 0 ? '  +' : '  ') + delta.toFixed(2)}`);
    }
}

console.log(`\nBranch win rate — vs ${enemies[0].Name}: ${(wins[enemies[0].Name] * 100).toFixed(0)}%  |  vs ${enemies[1].Name}: ${(wins[enemies[1].Name] * 100).toFixed(0)}%`);
console.log(`Realized = actual damage dealt (attacks) or damage prevented (block/shield/debuff), averaged per use over ${N.toLocaleString()} battles each.`);
table(branchW.name);
table(enemies[0].Name);
table(enemies[1].Name);
console.log('');
