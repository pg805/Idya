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

function runBattle(pWeapon: Weapon, eData: EnemyData): BattleResult {
    const player   = new CombatantState('Player', pWeapon.hp || 50, pWeapon.resource_name, pWeapon.resource_max);
    const eWeapon  = Weapon.from_json(eData.Weapon as any);
    const enemy    = new CombatantState(eData.Name, eData.Health, eWeapon.resource_name, eWeapon.resource_max, eData.Resistances ?? {});
    const pattern  = (eData.Pattern ?? []).map(([type, index]) => ({ type, index }));
    let   eIdx     = 0;

    let damageToEnemy  = 0;
    let damageToPlayer = 0;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const pChoice = choosePlayerAction(pWeapon, player);
        const eChoice = chooseEnemyAction(eWeapon, enemy, pattern, eIdx);
        eIdx = eChoice.nextIdx;

        const playerHits = aimedHits(pChoice.action);
        const enemyHits  = aimedHits(eChoice.action);

        // Crit: player attacks, enemy specials → attack_crit fires first.
        // Skipped if the player's main attack would miss its aim.
        if (playerHits && pChoice.category === 'attack' && eChoice.category === 'special' && pWeapon.attack_crit.length > 0) {
            const ehpBefore = enemy.health;
            resolve_action(player, enemy, [pWeapon.attack_crit[0]]);
            damageToEnemy += ehpBefore - enemy.health;
        }

        // Player action
        const ehp = enemy.health;
        const php = player.health;
        if (playerHits) resolve_action(player, enemy, [pChoice.action]);
        else            player.apply_cost(pChoice.action);
        damageToEnemy  += Math.max(0, ehp - enemy.health);
        if (enemy.health <= 0) return { winner: 'player', rounds: round + 1, playerHpLeft: player.health, damageToEnemy, damageToPlayer };

        // Enemy action
        if (enemyHits) resolve_action(enemy, player, [eChoice.action]);
        else           enemy.apply_cost(eChoice.action);
        damageToPlayer += Math.max(0, php - player.health);
        if (player.health <= 0) return { winner: 'enemy', rounds: round + 1, playerHpLeft: 0, damageToEnemy, damageToPlayer };

        player.end_round();
        enemy.end_round();
        damageToPlayer += Math.max(0, php - player.health); // capture any DOT
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

// ---- Main ----

const weapons = loadWeapons();
const enemies = loadEnemies();

console.log(`\nLoaded ${weapons.length} weapons, ${enemies.length} enemies`);
console.log(`Running ${N.toLocaleString()} × ${weapons.length} × ${enemies.length} = ${(N * weapons.length * enemies.length).toLocaleString()} battles...\n`);

const start = Date.now();
printTable(weapons, enemies);
console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
