// Silence logger before any imports that trigger it
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as any).silent = true;

import Weapon from '../weapon/weapon.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runBattle, aggregate, loadEnemies as loadEnemyFiles, EnemyData, BattleResult, Stats, MAX_ROUNDS, AIM_HIT_CHANCE } from './sim_core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const WEAPONS_DIR = join(__dirname, '../../database/weapons');
const ENEMIES_DIR = join(__dirname, '../../database/enemies');
const N           = 5_000;

// ---- Load weapons ----

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

const loadEnemies = () => loadEnemyFiles(ENEMIES_DIR);

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
