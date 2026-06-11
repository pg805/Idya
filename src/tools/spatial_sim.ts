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

const N = Number(process.argv[2] ?? 100);
const enemyArg = process.argv[3];

const weaponFiles = fs.readdirSync(WEAPONS).filter(f => f.endsWith('.yaml'));
// Default to the enemies tuned for the planner; pass a name to test just one.
const enemyNames = enemyArg
  ? [enemyArg]
  : fs.readdirSync(ENEMIES).filter(f => f.endsWith('.yaml'))
      .filter(f => (yaml.load(fs.readFileSync(join(ENEMIES, f), 'utf-8')) as { AI?: string }).AI === 'smart')
      .map(f => f.replace('.yaml', ''));

console.log(`\nSpatial sim — real engine + utility AI both sides, ${N} battles/matchup, ${BOARD_W}x${BOARD_H} board`);
console.log(`enemies: ${enemyNames.join(', ')}\n`);

for (const enemyName of enemyNames) {
  const enemyPath = join(ENEMIES, `${enemyName}.yaml`);
  console.log(`vs ${enemyName}`);
  console.log(`${'Weapon'.padEnd(18)}${'win%'.padStart(7)}${'rounds'.padStart(8)}${'HP% on win'.padStart(12)}${'timeout%'.padStart(10)}`);
  console.log('-'.repeat(55));
  const rows = weaponFiles.map(f => {
    const weapon = Weapon.from_file(join(WEAPONS, f));
    const results = Array.from({ length: N }, () => runSpatialBattle(weapon, enemyPath));
    return { name: weapon.name, ...aggregate(results) };
  }).sort((a, b) => b.winRate - a.winRate);
  for (const r of rows) {
    console.log(
      `${r.name.slice(0, 17).padEnd(18)}${(r.winRate * 100).toFixed(0).padStart(6)}%${r.avgRounds.toFixed(1).padStart(8)}` +
      `${(r.avgHpOnWin * 100).toFixed(0).padStart(11)}%${(r.timeoutRate * 100).toFixed(0).padStart(9)}%`,
    );
  }
  console.log('');
}
