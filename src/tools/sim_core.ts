// Shared Monte-Carlo battle core, used by both simulate.ts (full tables / JSON)
// and cost_report.ts (a quick win% column next to the budget). Non-spatial: it
// approximates aimed-attack dodging with a flat hit chance and otherwise mirrors
// resolution.ts's order (defend → attack → special, initiative within each).
import { CombatantState } from '../combat/combatant_state.js';
import { resolve_action } from '../combat/action_resolver.js';
import Weapon from '../weapon/weapon.js';
import Action from '../weapon/action.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { join } from 'path';

export const MAX_ROUNDS = 80;

// Real combat is spatial — a target can step off an aimed tile. Without this roll
// the sim assumes every aimed attack lands, overstating big aimed actions.
export const AIM_HIT_CHANCE = 0.5;
const aimedHits = (action: Action): boolean => !action.aimed || Math.random() < AIM_HIT_CHANCE;

export type EnemyData = {
    Name: string;
    Health: number;
    Level?: number;
    Pattern: [number, number][];
    Weapon: Record<string, unknown>;
    Resistances?: Record<string, number>;
};

type PatternEntry = { type: number; index: number };
type ActionChoice = { action: Action; category: 'defend' | 'attack' | 'special' };

export type BattleResult = {
    winner: 'player' | 'enemy' | 'timeout';
    rounds: number;
    playerHpLeft: number;
    damageToEnemy: number;
    damageToPlayer: number;
};

export type Stats = {
    winRate: number;
    avgRounds: number;
    avgRoundsWin: number;
    avgHpLeft: number;
    avgDmgToEnemy: number;
    avgDmgToPlayer: number;
    timeoutRate: number;
};

// Player strategy: greedy attack — attack[0] if affordable, else a restore, else
// any affordable action, else defend[0].
function choosePlayerAction(weapon: Weapon, state: CombatantState): ActionChoice {
    if (weapon.attack.length > 0 && weapon.attack[0].cost <= state.resource_current) {
        return { action: weapon.attack[0], category: 'attack' };
    }
    for (const a of [...weapon.defend, ...weapon.special]) {
        if (a.cost < 0) return { action: a, category: weapon.defend.includes(a) ? 'defend' : 'special' };
    }
    for (const a of [...weapon.defend, ...weapon.special]) {
        if (a.cost <= state.resource_current) return { action: a, category: weapon.defend.includes(a) ? 'defend' : 'special' };
    }
    return { action: weapon.defend[0], category: 'defend' };
}

// Turn-1 regain: combatants start ≥1 tile apart, so nobody can attack round 1.
function chooseRegain(weapon: Weapon): ActionChoice {
    for (const a of [...weapon.defend, ...weapon.special]) if (a.cost < 0) return { action: a, category: weapon.defend.includes(a) ? 'defend' : 'special' };
    return { action: weapon.defend[0], category: 'defend' };
}

function chooseEnemyAction(weapon: Weapon, state: CombatantState, pattern: PatternEntry[], idx: number): ActionChoice & { nextIdx: number } {
    for (let i = 0; i < pattern.length; i++) {
        const entry = pattern[(idx + i) % pattern.length];
        let action: Action | null = null;
        let category: 'defend' | 'attack' | 'special' = 'defend';
        if (entry.type === 1) { action = weapon.defend[entry.index] ?? null;  category = 'defend'; }
        if (entry.type === 2) { action = weapon.attack[entry.index] ?? null;  category = 'attack'; }
        if (entry.type === 3) { action = weapon.special[entry.index] ?? null; category = 'special'; }
        if (!action) continue;
        if (action.cost > 0 && action.cost > state.resource_current) continue;
        return { action, category, nextIdx: (idx + i + 1) % pattern.length };
    }
    const all: { a: Action; category: 'defend' | 'attack' | 'special' }[] = [
        ...weapon.defend.map(a => ({ a, category: 'defend' as const })),
        ...weapon.attack.map(a => ({ a, category: 'attack' as const })),
        ...weapon.special.map(a => ({ a, category: 'special' as const })),
    ];
    const found = all.find(x => x.a.cost <= 0 || x.a.cost <= state.resource_current);
    return { action: found?.a ?? weapon.defend[0], category: found?.category ?? 'defend', nextIdx: (idx + 1) % pattern.length };
}

const initScore = (weight: number) => Math.floor(Math.random() * 100) + 1 - weight;

// Mirrors resolution.ts: action phase runs defend → attack → special, each in
// initiative order (1d100 − weight, rolled once per battle, player wins ties).
export function runBattle(pWeapon: Weapon, eData: EnemyData): BattleResult {
    const player   = new CombatantState('Player', pWeapon.hp || 50, pWeapon.resource_name, pWeapon.resource_max);
    const eWeapon  = Weapon.from_json(eData.Weapon as any);
    const enemy    = new CombatantState(eData.Name, eData.Health, eWeapon.resource_name, eWeapon.resource_max, eData.Resistances ?? {});
    const pattern  = (eData.Pattern ?? []).map(([type, index]) => ({ type, index }));
    let   eIdx     = 0;

    let damageToEnemy  = 0;
    let damageToPlayer = 0;

    const playerFirst = initScore((pWeapon as any).weight ?? 0) >= initScore((eWeapon as any).weight ?? 0);

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const pChoice = round === 0 ? chooseRegain(pWeapon) : choosePlayerAction(pWeapon, player);
        let eChoice: ActionChoice;
        if (round === 0) { eChoice = chooseRegain(eWeapon); }
        else { const ec = chooseEnemyAction(eWeapon, enemy, pattern, eIdx); eIdx = ec.nextIdx; eChoice = ec; }

        const sides = [
            { self: player, foe: enemy,  choice: pChoice, hits: aimedHits(pChoice.action), crit: pWeapon.attack_crit[0] ?? null, foeCat: eChoice.category, isPlayer: true  },
            { self: enemy,  foe: player, choice: eChoice, hits: aimedHits(eChoice.action), crit: eWeapon.attack_crit[0] ?? null, foeCat: pChoice.category, isPlayer: false },
        ];
        const order = playerFirst ? [sides[0], sides[1]] : [sides[1], sides[0]];

        for (const phase of ['defend', 'attack', 'special'] as const) {
            for (const s of order) {
                if (s.choice.category !== phase) continue;
                if (s.self.health <= 0 || s.foe.health <= 0) continue;

                const foeBefore = s.foe.health;
                if (s.hits) {
                    resolve_action(s.self, s.foe, [s.choice.action]);
                    if (phase === 'attack' && s.crit && s.foeCat === 'special' && s.foe.health > 0) {
                        resolve_action(s.self, s.foe, [s.crit]);
                    }
                } else {
                    s.self.apply_cost(s.choice.action);
                }
                const dealt = Math.max(0, foeBefore - s.foe.health);
                if (s.isPlayer) damageToEnemy += dealt; else damageToPlayer += dealt;

                if (s.foe.health <= 0) {
                    return { winner: s.isPlayer ? 'player' : 'enemy', rounds: round + 1, playerHpLeft: player.health, damageToEnemy, damageToPlayer };
                }
            }
        }

        for (const s of order) {
            const before = s.self.health;
            s.self.end_round();
            const dot = Math.max(0, before - s.self.health);
            if (s.isPlayer) damageToPlayer += dot; else damageToEnemy += dot;
            if (s.self.health <= 0) {
                return { winner: s.isPlayer ? 'enemy' : 'player', rounds: round + 1, playerHpLeft: player.health, damageToEnemy, damageToPlayer };
            }
        }
    }

    return { winner: 'timeout', rounds: MAX_ROUNDS, playerHpLeft: player.health, damageToEnemy, damageToPlayer };
}

export function aggregate(results: BattleResult[]): Stats {
    const wins     = results.filter(r => r.winner === 'player');
    const timeouts = results.filter(r => r.winner === 'timeout');
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return {
        winRate:        wins.length / results.length,
        avgRounds:      avg(results.map(r => r.rounds)),
        avgRoundsWin:   avg(wins.map(r => r.rounds)),
        avgHpLeft:      avg(wins.map(r => r.playerHpLeft)),
        avgDmgToEnemy:  avg(results.map(r => r.damageToEnemy / r.rounds)),
        avgDmgToPlayer: avg(results.map(r => r.damageToPlayer / r.rounds)),
        timeoutRate:    timeouts.length / results.length,
    };
}

export function loadEnemies(dir: string): { key: string; data: EnemyData }[] {
    const out: { key: string; data: EnemyData }[] = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
        try {
            const data = yaml.load(fs.readFileSync(join(dir, f), 'utf-8')) as EnemyData;
            out.push({ key: f.replace('.yaml', ''), data });
        } catch { /* skip */ }
    }
    return out.sort((a, b) => a.data.Health - b.data.Health);
}
