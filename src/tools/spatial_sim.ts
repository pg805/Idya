// Headless spatial battle sim. Unlike the old non-spatial simulate.ts, this runs
// the REAL engine (resolveIntents) on a REAL board with the REAL utility AI
// (choosePlan) driving BOTH sides — so it finally grades positional / defensive /
// AoE kits honestly. Roll RNG + random boards make repeated runs a distribution.
//
//   node ./lib/tools/spatial_sim.js [iterations] [enemy]    # win% table
//   node ./lib/tools/spatial_sim.js debug  <enemy> <weapon> # trace one battle
//   node ./lib/tools/spatial_sim.js replay <enemy> <weapon> # write a replay JSON
//
// The board/player builders + the replay capture live in combat/replay_sim.ts so
// the dev API (/api/dev/replay → the dev replay view) shares them.
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as { silent?: boolean }).silent = true;

import Weapon from '../weapon/weapon.js';
import { loadEnemy } from '../combat/enemy_loader.js';
import { CombatSession, CombatantMeta, Team } from '../combat/combat_session.js';
import { resolveIntents } from '../combat/resolution.js';
import { choosePlan } from '../combat/ai_planner.js';
import { MAX_ROUNDS, MOVE_RANGE, BOARD_W, BOARD_H, genBoard, buildPlayerUnit, generateReplay } from '../combat/replay_sim.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEAPONS = join(__dirname, '../../database/weapons');
const ENEMIES = join(__dirname, '../../database/enemies');

type Outcome = 'win' | 'loss' | 'timeout';
interface BattleResult { outcome: Outcome; rounds: number; playerHpFrac: number; }

// One battle: choosePlan drives both teams every turn until a wipe or the cap.
function runSpatialBattle(weapon: Weapon, enemyPath: string): BattleResult {
  const { board, playerSpawn, enemySpawn } = genBoard();
  const player = buildPlayerUnit(weapon, playerSpawn);
  const enemy = loadEnemy(enemyPath, { id: 'enemy-1', teamId: 'team-b', pos: enemySpawn, movementRange: MOVE_RANGE });

  const teams: Team[] = [
    { id: 'team-a', name: 'Player', combatants: [player.combatant] },
    { id: 'team-b', name: 'Enemy', combatants: [enemy.combatant] },
  ];
  const session = new CombatSession('sim', board, teams);
  session.meta.set('player-1', player.meta);
  session.meta.set('enemy-1', enemy.meta);
  session.phase = 'intent';

  const hpFrac = () => (session.meta.get('player-1')?.state.health ?? 0) / (weapon.hp || 1);

  let rounds = 0;
  for (; rounds < MAX_ROUNDS; rounds++) {
    if (session.teams.some(t => t.combatants.length === 0)) break;
    const intents = new Map(session.combatants.map(c => [c.id, choosePlan(c, session)]));
    const { winner } = resolveIntents(session, intents);
    if (winner) return { outcome: winner === 'team-a' ? 'win' : 'loss', rounds: rounds + 1, playerHpFrac: hpFrac() };
  }
  return { outcome: 'timeout', rounds, playerHpFrac: hpFrac() };
}

interface Agg { win: number; loss: number; timeout: number; rounds: number; hpOnWin: number; }
function aggregate(results: BattleResult[]): { winRate: number; avgRounds: number; avgHpOnWin: number; timeoutRate: number } {
  const a: Agg = { win: 0, loss: 0, timeout: 0, rounds: 0, hpOnWin: 0 };
  for (const r of results) {
    a.rounds += r.rounds;
    if (r.outcome === 'win') { a.win++; a.hpOnWin += r.playerHpFrac; }
    else if (r.outcome === 'loss') a.loss++;
    else a.timeout++;
  }
  const n = results.length || 1;
  return { winRate: a.win / n, avgRounds: a.rounds / n, avgHpOnWin: a.win ? a.hpOnWin / a.win : 0, timeoutRate: a.timeout / n };
}

// --- CLI ---
// Debug: trace ONE battle turn-by-turn.
if (process.argv[2] === 'debug') {
  const enemyPath = join(ENEMIES, `${process.argv[3] ?? 'melbear'}.yaml`);
  const weapon = Weapon.from_file(join(WEAPONS, `${process.argv[4] ?? 'mace'}.yaml`));
  const { board, playerSpawn, enemySpawn } = genBoard();
  const player = buildPlayerUnit(weapon, playerSpawn);
  const enemy = loadEnemy(enemyPath, { id: 'enemy-1', teamId: 'team-b', pos: enemySpawn, movementRange: MOVE_RANGE });
  const teams: Team[] = [
    { id: 'team-a', name: 'Player', combatants: [player.combatant] },
    { id: 'team-b', name: 'Enemy', combatants: [enemy.combatant] },
  ];
  const session = new CombatSession('sim', board, teams);
  session.meta.set('player-1', player.meta);
  session.meta.set('enemy-1', enemy.meta);
  session.phase = 'intent';
  const nameOf = (m: CombatantMeta, t: string, i: number) => (m.weapon as unknown as Record<string, { name: string }[]>)[t]?.[i]?.name ?? t;
  console.log(`${weapon.name} @${JSON.stringify(playerSpawn)} vs ${process.argv[3]} @${JSON.stringify(enemySpawn)}, ${board.obstacles.length} obstacles\n`);
  for (let turn = 0; turn < MAX_ROUNDS; turn++) {
    if (session.teams.some(t => t.combatants.length === 0)) break;
    const intents = new Map(session.combatants.map(c => [c.id, choosePlan(c, session)]));
    let line = `T${turn + 1}`;
    for (const c of session.combatants) {
      const it = intents.get(c.id)!;
      const m = session.meta.get(c.id)!;
      const act = it.action.type === 'pass' ? 'pass' : nameOf(m, it.action.type, it.action.actionIndex);
      line += `  | ${c.name}(${c.pos.x},${c.pos.y} hp${m.state.health}) → ${it.moveTo ? `mv(${it.moveTo.x},${it.moveTo.y}) ` : ''}${act}${it.action.targetPos ? `@(${it.action.targetPos.x},${it.action.targetPos.y})` : ''}`;
    }
    console.log(line);
    const { winner } = resolveIntents(session, intents);
    if (winner) { console.log(`\nwinner: ${winner}`); break; }
  }
  process.exit(0);
}

// Replay: record ONE battle's full per-turn trace to JSON (for offline viewing /
// the dev replay view loads the same shape live from /api/dev/replay).
if (process.argv[2] === 'replay') {
  const outFile = process.argv[5] ?? join(__dirname, '../../public/replay.json');
  const data = generateReplay(process.argv[4] ?? 'battle_axe', process.argv[3] ?? 'golnosar');
  fs.writeFileSync(outFile, JSON.stringify(data));
  console.log(`wrote ${data.turns.length} turns -> ${outFile}  (winner: ${data.result.winner ?? 'timeout'}, ${data.result.rounds} rounds)`);
  process.exit(0);
}

// Usage scan: which actions does the AI never pick? `node spatial_sim.js usage [N]`.
// Drives both sides with choosePlan across every weapon×enemy and tallies the
// chosen action each turn — NEVER-used actions are scoring blind spots.
if (process.argv[2] === 'usage') {
  const N = Number(process.argv[3] ?? 25);
  const weaponFiles = fs.readdirSync(WEAPONS).filter(f => f.endsWith('.yaml'));
  const enemyFiles = fs.readdirSync(ENEMIES).filter(f => f.endsWith('.yaml') && f !== 'tutorial_swallow.yaml');

  const acts = new Map<string, { name: string; cat: string; type: string }[]>();
  const used = new Map<string, Map<string, number>>();
  const decisions = new Map<string, number>();
  const register = (w: Weapon) => {
    if (acts.has(w.name)) return;
    const list = [
      ...w.defend.map(a => ({ name: a.name, cat: 'D', type: a.type_name || String(a.type) })),
      ...w.attack.map(a => ({ name: a.name, cat: 'A', type: a.type_name || String(a.type) })),
      ...w.special.map(a => ({ name: a.name, cat: 'S', type: a.type_name || String(a.type) })),
    ];
    acts.set(w.name, list);
    used.set(w.name, new Map(list.map(a => [a.name, 0])));
    decisions.set(w.name, 0);
  };
  const nameOf = (m: CombatantMeta, t: string, i: number) => (m.weapon as unknown as Record<string, { name: string }[]>)[t]?.[i]?.name;

  for (const wf of weaponFiles) {
    const weapon = Weapon.from_file(join(WEAPONS, wf));
    register(weapon);
    for (const ef of enemyFiles) {
      const enemyPath = join(ENEMIES, ef);
      for (let i = 0; i < N; i++) {
        const { board, playerSpawn, enemySpawn } = genBoard();
        const player = buildPlayerUnit(weapon, playerSpawn);
        const enemy = loadEnemy(enemyPath, { id: 'enemy-1', teamId: 'team-b', pos: enemySpawn, movementRange: MOVE_RANGE });
        register(enemy.meta.weapon);
        const teams: Team[] = [
          { id: 'team-a', name: 'P', combatants: [player.combatant] },
          { id: 'team-b', name: 'E', combatants: [enemy.combatant] },
        ];
        const session = new CombatSession('u', board, teams);
        session.meta.set('player-1', player.meta);
        session.meta.set('enemy-1', enemy.meta);
        session.phase = 'intent';
        for (let n = 0; n < MAX_ROUNDS; n++) {
          if (session.teams.some(t => t.combatants.length === 0)) break;
          const intents = new Map(session.combatants.map(c => [c.id, choosePlan(c, session)]));
          for (const c of session.combatants) {
            const it = intents.get(c.id)!;
            if (it.action.type === 'pass') continue;
            const m = session.meta.get(c.id)!;
            const an = nameOf(m, it.action.type, it.action.actionIndex);
            if (!an) continue;
            used.get(m.weapon.name)!.set(an, (used.get(m.weapon.name)!.get(an) ?? 0) + 1);
            decisions.set(m.weapon.name, (decisions.get(m.weapon.name) ?? 0) + 1);
          }
          if (resolveIntents(session, intents).winner) break;
        }
      }
    }
  }

  console.log(`\nAction usage scan — ${N} battles/matchup, both sides AI. ✗ = NEVER picked (blind spot), ~x% = rare.\n`);
  for (const [wname, list] of acts) {
    const u = used.get(wname)!;
    const total = decisions.get(wname) || 1;
    const flagged = list.filter(a => (u.get(a.name) ?? 0) / total < 0.01);
    if (flagged.length === 0) continue;
    console.log(`${wname}:`);
    for (const a of flagged) {
      const c = u.get(a.name) ?? 0;
      console.log(`  ${c === 0 ? '✗ NEVER  ' : `~${((c / total) * 100).toFixed(1)}%   `}[${a.cat}] ${a.name} (${a.type})`);
    }
  }
  console.log('');
  process.exit(0);
}

// Diagnostics: `node spatial_sim.js diag [N]` — first-mover advantage, aimed-attack
// hit rate, timeout rate, restore reliance. Surfaces problem spots beyond kiting.
if (process.argv[2] === 'diag') {
  const N = Number(process.argv[3] ?? 40);
  const weaponFiles = fs.readdirSync(WEAPONS).filter(f => f.endsWith('.yaml'));
  const enemyFiles = fs.readdirSync(ENEMIES).filter(f => f.endsWith('.yaml') && f !== 'tutorial_swallow.yaml');
  let fW = 0, fT = 0, sW = 0, sT = 0;            // first/second mover wins & totals
  let aAtt = 0, aHit = 0, restores = 0, decisions = 0;
  let timeouts = 0, battles = 0;

  for (const wf of weaponFiles) {
    const weapon = Weapon.from_file(join(WEAPONS, wf));
    for (const ef of enemyFiles) {
      const enemyPath = join(ENEMIES, ef);
      for (let i = 0; i < N; i++) {
        const { board, playerSpawn, enemySpawn } = genBoard();
        const player = buildPlayerUnit(weapon, playerSpawn);
        const enemy = loadEnemy(enemyPath, { id: 'enemy-1', teamId: 'team-b', pos: enemySpawn, movementRange: MOVE_RANGE });
        const teams: Team[] = [
          { id: 'team-a', name: 'P', combatants: [player.combatant] },
          { id: 'team-b', name: 'E', combatants: [enemy.combatant] },
        ];
        const session = new CombatSession('d', board, teams);
        session.meta.set('player-1', player.meta);
        session.meta.set('enemy-1', enemy.meta);
        session.phase = 'intent';
        const pFirst = player.combatant.initiativeRank < enemy.combatant.initiativeRank;
        let winner: string | null = null;
        for (let n = 0; n < MAX_ROUNDS; n++) {
          if (session.teams.some(t => t.combatants.length === 0)) break;
          const intents = new Map(session.combatants.map(c => [c.id, choosePlan(c, session)]));
          winner = resolveIntents(session, intents).winner;
          if (winner) break;
        }
        battles++;
        if (!winner) timeouts++;
        const pWon = winner === 'team-a';
        if (pFirst) { fT++; if (pWon) fW++; } else { sT++; if (pWon) sW++; }
        const ps = player.meta.state;
        aAtt += ps.aimed_attempted; aHit += ps.aimed_hit; restores += ps.restores;
      }
    }
  }
  console.log(`\nDiagnostics — ${battles} battles, both sides AI\n`);
  console.log(`First-mover win%:   went first ${(fW / (fT || 1) * 100).toFixed(0)}%  vs  went second ${(sW / (sT || 1) * 100).toFixed(0)}%`);
  console.log(`Aimed-attack hits:  ${(aHit / (aAtt || 1) * 100).toFixed(0)}%  (${aHit}/${aAtt} attempts)`);
  console.log(`Timeout rate:       ${(timeouts / battles * 100).toFixed(0)}%`);
  console.log('');
  process.exit(0);
}

const N = Number(process.argv[2] ?? 100);
const enemyArg = process.argv[3];

const weaponFiles = fs.readdirSync(WEAPONS).filter(f => f.endsWith('.yaml'));
const allEnemyFiles = fs.readdirSync(ENEMIES).filter(f => f.endsWith('.yaml') && f !== 'tutorial_swallow.yaml');
// `all` → every enemy; a name → just that one; default → enemies tuned for the planner.
const enemyNames = enemyArg === 'all'
  ? allEnemyFiles.map(f => f.replace('.yaml', ''))
  : enemyArg
    ? [enemyArg]
    : allEnemyFiles
        .filter(f => (yaml.load(fs.readFileSync(join(ENEMIES, f), 'utf-8')) as { AI?: string }).AI === 'smart')
        .map(f => f.replace('.yaml', ''));

const lvlOf = (file: string) => (yaml.load(fs.readFileSync(file, 'utf-8')) as { Level?: number }).Level ?? 0;
const wLevel = new Map(weaponFiles.map(f => [f, lvlOf(join(WEAPONS, f))]));

console.log(`\nSpatial sim — real engine + utility AI both sides, ${N} battles/matchup, ${BOARD_W}x${BOARD_H} board`);
console.log(`enemies: ${enemyNames.join(', ')}\n`);

const matrix: { wLvl: number; eLvl: number; win: number }[] = [];

for (const enemyName of enemyNames) {
  const enemyPath = join(ENEMIES, `${enemyName}.yaml`);
  const eLvl = lvlOf(enemyPath);
  console.log(`vs ${enemyName} (L${eLvl})`);
  console.log(`${'Weapon'.padEnd(18)}${'lvl'.padStart(4)}${'win%'.padStart(7)}${'rounds'.padStart(8)}${'HP%'.padStart(6)}${'t/o%'.padStart(7)}`);
  console.log('-'.repeat(50));
  const rows = weaponFiles.map(f => {
    const weapon = Weapon.from_file(join(WEAPONS, f));
    const agg = aggregate(Array.from({ length: N }, () => runSpatialBattle(weapon, enemyPath)));
    const lvl = wLevel.get(f) ?? 0;
    matrix.push({ wLvl: lvl, eLvl, win: agg.winRate });
    return { name: weapon.name, lvl, ...agg };
  }).sort((a, b) => a.lvl - b.lvl || b.winRate - a.winRate);
  for (const r of rows) {
    console.log(
      `${r.name.slice(0, 17).padEnd(18)}${('L' + r.lvl).padStart(4)}${(r.winRate * 100).toFixed(0).padStart(6)}%${r.avgRounds.toFixed(1).padStart(8)}` +
      `${(r.avgHpOnWin * 100).toFixed(0).padStart(5)}%${(r.timeoutRate * 100).toFixed(0).padStart(6)}%`,
    );
  }
  console.log('');
}

// Aggregate: avg win% by weapon level (rows) x enemy level (cols).
const wLvls = [...new Set(matrix.map(m => m.wLvl))].sort((a, b) => a - b);
const eLvls = [...new Set(matrix.map(m => m.eLvl))].sort((a, b) => a - b);
console.log('Avg win% — weapon level (row) vs enemy level (col):');
console.log(`${'wL\\eL'.padEnd(7)}${eLvls.map(e => ('L' + e).padStart(7)).join('')}`);
for (const wl of wLvls) {
  let line = ('L' + wl).padEnd(7);
  for (const el of eLvls) {
    const cells = matrix.filter(m => m.wLvl === wl && m.eLvl === el);
    const avg = cells.length ? cells.reduce((s, c) => s + c.win, 0) / cells.length : null;
    line += (avg === null ? '—' : `${(avg * 100).toFixed(0)}%`).padStart(7);
  }
  console.log(line);
}
console.log('');
