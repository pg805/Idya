// Silence logger before any imports that trigger it
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as any).silent = true;

import { CombatantState } from '../combat/combatant_state.js';
import { resolve_action } from '../combat/action_resolver.js';
import Weapon from '../weapon/weapon.js';
import Action from '../weapon/action.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const WEAPONS_DIR = join(__dirname, '../../database/weapons');
const ENEMIES_DIR = join(__dirname, '../../database/enemies');
const MAX_ROUNDS  = 80;
const N           = 5_000;

// Sim approximation: real combat is spatial, so a target can dodge an aimed
// attack by moving off the targeted tile. Without this roll the sim assumes
// every aimed attack lands, which overstates damage from big aimed actions
// like Fistar or Ursa Major.
const AIM_HIT_CHANCE = 0.5;
const aimedHits = (action: Action): boolean => !action.aimed || Math.random() < AIM_HIT_CHANCE;

// ---- Types ----

type EnemyData = {
    Name: string;
    Health: number;
    Level?: number;
    Pattern: [number, number][];
    Weapon: Record<string, unknown>;
    Resistances?: Record<string, number>;
};

type PatternEntry = { type: number; index: number };

type ActionChoice = {
    action: Action;
    category: 'defend' | 'attack' | 'special';
};

// ---- Player strategy: greedy attack ----
// Always use attack[0] if affordable. When out of resource, use
// the first action with negative cost (resource restore). Fallback to defend[0].

function choosePlayerAction(weapon: Weapon, state: CombatantState): ActionChoice {
    if (weapon.attack.length > 0 && weapon.attack[0].cost <= state.resource_current) {
        return { action: weapon.attack[0], category: 'attack' };
    }
    // Find a restore action (negative cost = restore resource)
    for (const a of [...weapon.defend, ...weapon.special]) {
        if (a.cost < 0) return { action: a, category: weapon.defend.includes(a) ? 'defend' : 'special' };
    }
    // Any affordable action
    for (const a of [...weapon.defend, ...weapon.special]) {
        if (a.cost <= state.resource_current) return { action: a, category: weapon.defend.includes(a) ? 'defend' : 'special' };
    }
    return { action: weapon.defend[0], category: 'defend' };
}

// ---- Enemy strategy: follow pattern ----

// Turn-1 regain: combatants start ≥1 tile apart, so nobody can attack round 1.
// Both spend it regaining (restore action) or holding.
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
    // Fallback: first affordable action in any category
    const all: { a: Action; category: 'defend' | 'attack' | 'special' }[] = [
        ...weapon.defend.map(a => ({ a, category: 'defend' as const })),
        ...weapon.attack.map(a => ({ a, category: 'attack' as const })),
        ...weapon.special.map(a => ({ a, category: 'special' as const })),
    ];
    const found = all.find(x => x.a.cost <= 0 || x.a.cost <= state.resource_current);
    return { action: found?.a ?? weapon.defend[0], category: found?.category ?? 'defend', nextIdx: (idx + 1) % pattern.length };
}

// ---- Battle ----

type BattleResult = {
    winner: 'player' | 'enemy' | 'timeout';
    rounds: number;
    playerHpLeft: number;
    damageToEnemy: number;
    damageToPlayer: number;
};

const initScore = (weight: number) => Math.floor(Math.random() * 100) + 1 - weight;

// Mirrors resolution.ts: action phase runs defend → attack → special, each in
// initiative order (1d100 − weight, rolled once per battle, player wins ties).
// Resolving all defends before any attack is what makes blocks actually work.
function runBattle(pWeapon: Weapon, eData: EnemyData): BattleResult {
    const player   = new CombatantState('Player', pWeapon.hp || 50, pWeapon.resource_name, pWeapon.resource_max);
    const eWeapon  = Weapon.from_json(eData.Weapon as any);
    const enemy    = new CombatantState(eData.Name, eData.Health, eWeapon.resource_name, eWeapon.resource_max, eData.Resistances ?? {});
    const pattern  = (eData.Pattern ?? []).map(([type, index]) => ({ type, index }));
    let   eIdx     = 0;

    let damageToEnemy  = 0;
    let damageToPlayer = 0;

    const playerFirst = initScore((pWeapon as any).weight ?? 0) >= initScore((eWeapon as any).weight ?? 0);

    for (let round = 0; round < MAX_ROUNDS; round++) {
        // Round 0 is the approach: both regain, enemy pattern does not advance.
        const pChoice = round === 0 ? chooseRegain(pWeapon) : choosePlayerAction(pWeapon, player);
        let eChoice: ActionChoice;
        if (round === 0) { eChoice = chooseRegain(eWeapon); }
        else { const ec = chooseEnemyAction(eWeapon, enemy, pattern, eIdx); eIdx = ec.nextIdx; eChoice = ec; }

        const sides = [
            { self: player, foe: enemy,  choice: pChoice, hits: aimedHits(pChoice.action), crit: pWeapon.attack_crit[0] ?? null, foeCat: eChoice.category, isPlayer: true  },
            { self: enemy,  foe: player, choice: eChoice, hits: aimedHits(eChoice.action), crit: eWeapon.attack_crit[0] ?? null, foeCat: pChoice.category, isPlayer: false },
        ];
        const order = playerFirst ? [sides[0], sides[1]] : [sides[1], sides[0]];

        // Action phase: defend → attack → special, initiative order within each.
        for (const phase of ['defend', 'attack', 'special'] as const) {
            for (const s of order) {
                if (s.choice.category !== phase) continue;
                if (s.self.health <= 0 || s.foe.health <= 0) continue;

                const foeBefore = s.foe.health;
                if (s.hits) {
                    resolve_action(s.self, s.foe, [s.choice.action]);
                    // crit fires after the main attack when the target intended a special
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

        // End of round: tick DOT / status in initiative order.
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

// ---- Stats aggregation ----

type Stats = {
    winRate: number;
    avgRounds: number;
    avgRoundsWin: number;
    avgHpLeft: number;
    avgDmgToEnemy: number;
    avgDmgToPlayer: number;
    timeoutRate: number;
};

function aggregate(results: BattleResult[]): Stats {
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

// ---- Load files ----

function loadWeapons(): { key: string; name: string; level: number; weapon: Weapon }[] {
    const out: { key: string; name: string; level: number; weapon: Weapon }[] = [];
    for (const f of fs.readdirSync(WEAPONS_DIR).filter(f => f.endsWith('.yaml'))) {
        try {
            const raw = yaml.load(fs.readFileSync(join(WEAPONS_DIR, f), 'utf-8')) as Record<string, unknown>;
            const w = Weapon.from_file(join(WEAPONS_DIR, f));
            if (w.attack.length === 0) continue;
            out.push({ key: f.replace('.yaml', ''), name: w.name, level: (raw['Level'] as number) ?? 0, weapon: w });
        } catch { /* skip malformed */ }
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
}

function loadEnemies(): { key: string; data: EnemyData }[] {
    const out: { key: string; data: EnemyData }[] = [];
    for (const f of fs.readdirSync(ENEMIES_DIR).filter(f => f.endsWith('.yaml'))) {
        try {
            const data = yaml.load(fs.readFileSync(join(ENEMIES_DIR, f), 'utf-8')) as EnemyData;
            out.push({ key: f.replace('.yaml', ''), data });
        } catch { /* skip */ }
    }
    return out.sort((a, b) => a.data.Health - b.data.Health);
}

// ---- Formatting ----

const fmt = {
    pct:   (v: number) => `${(v * 100).toFixed(0)}%`.padStart(4),
    num1:  (v: number) => v.toFixed(1).padStart(5),
    num0:  (v: number) => v.toFixed(0).padStart(4),
};

function printTable(weapons: { key: string; name: string; level: number; weapon: Weapon }[], enemies: { key: string; data: EnemyData }[]) {
    const COL = 32;
    const ECOL = 38;

    // Header
    const header = 'Weapon'.padEnd(COL) + enemies.map(e => `  ${e.data.Name} L${e.data.Level ?? '?'} (${e.data.Health}hp)`.padEnd(ECOL)).join('');
    const subhdr = ' '.repeat(COL) + enemies.map(() => `  ${'Win%'.padEnd(5)}${'Rds'.padEnd(5)}${'HP'.padEnd(5)}${'DPR'.padEnd(5)}${'DTR'.padEnd(5)}`.padEnd(ECOL)).join('');
    const divider = '-'.repeat(COL + ECOL * enemies.length);

    console.log('\n' + divider);
    console.log(header);
    console.log(subhdr);
    console.log(divider);

    for (const { name, level, weapon } of weapons) {
        const label = `${name} (L${level})`.slice(0, COL - 1).padEnd(COL);
        let row = label;
        for (const { data } of enemies) {
            const results: BattleResult[] = [];
            for (let i = 0; i < N; i++) results.push(runBattle(weapon, data));
            const s = aggregate(results);
            const timeoutNote = s.timeoutRate > 0.05 ? '*' : ' ';
            row += `  ${fmt.pct(s.winRate)}${timeoutNote}${fmt.num1(s.avgRoundsWin)}${fmt.num1(s.avgHpLeft)}${fmt.num1(s.avgDmgToEnemy)}${fmt.num1(s.avgDmgToPlayer)}`.padEnd(ECOL);
        }
        console.log(row);
    }

    console.log(divider);
    console.log('  * >5% timeouts (max rounds hit — weapon may stall)');
    console.log('  Columns: Win% | Avg rounds to win | Avg HP left | Damage per round to enemy | Damage per round taken');
    console.log('  Strategy: greedy attack (attack[0] always, defend/restore when out of resource)');
    console.log(`  N = ${N.toLocaleString()} battles per matchup\n`);
}

// ---- JSON dump ----
// `--json <path>` skips the stdout table and writes a canonical sim file the
// dev stats page can render. Schema is intentionally flat (one row per
// weapon × enemy) so the UI can pivot without re-deriving anything.
function dumpJson(
    weapons: { key: string; name: string; level: number; weapon: Weapon }[],
    enemies: { key: string; data: EnemyData }[],
    outPath: string,
) {
    const matchups: Array<{ weapon_key: string; weapon_name: string; weapon_level: number; enemy_key: string; enemy_name: string; enemy_level: number; enemy_hp: number } & Stats> = [];
    for (const w of weapons) {
        for (const e of enemies) {
            const results: BattleResult[] = [];
            for (let i = 0; i < N; i++) results.push(runBattle(w.weapon, e.data));
            const s = aggregate(results);
            matchups.push({
                weapon_key: w.key, weapon_name: w.name, weapon_level: w.level,
                enemy_key:  e.key, enemy_name:  e.data.Name, enemy_level: e.data.Level ?? 0, enemy_hp: e.data.Health,
                ...s,
            });
        }
    }
    const payload = {
        n_per_matchup: N,
        max_rounds:    MAX_ROUNDS,
        aim_hit_chance: AIM_HIT_CHANCE,
        generated_at:  new Date().toISOString(),
        matchups,
    };
    const dir = dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${matchups.length} matchups to ${outPath}`);
}

// ---- Main ----

// `--weapons key1,key2` / `--enemies key1,key2` restrict the run to specific
// weapon / enemy files (by key). Omit either to run the full set.
function argFilter(flag: string): Set<string> | null {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',')) : null;
}

const weaponFilter = argFilter('--weapons');
const weapons = weaponFilter ? loadWeapons().filter(w => weaponFilter.has(w.key)) : loadWeapons();

const enemyFilter = argFilter('--enemies');
const enemies = enemyFilter ? loadEnemies().filter(e => enemyFilter.has(e.key)) : loadEnemies();

const jsonFlag = process.argv.indexOf('--json');
if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    const outPath = process.argv[jsonFlag + 1];
    console.log(`\nSimulating ${weapons.length} × ${enemies.length} matchups → ${outPath}`);
    const start = Date.now();
    dumpJson(weapons, enemies, outPath);
    console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
} else {
    console.log(`\nLoaded ${weapons.length} weapons, ${enemies.length} enemies`);
    console.log(`Running ${N.toLocaleString()} × ${weapons.length} × ${enemies.length} = ${(N * weapons.length * enemies.length).toLocaleString()} battles...\n`);

    const start = Date.now();
    printTable(weapons, enemies);
    console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}
