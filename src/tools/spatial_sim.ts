// Headless spatial battle sim. Unlike the old non-spatial simulate.ts, this runs
// the REAL engine (resolveIntents) on a REAL board with the REAL utility AI
// (choosePlan) driving BOTH sides — so it finally grades positional / defensive /
// AoE kits honestly. Roll RNG + random boards make repeated runs a distribution.
//
//   npm run build && node ./lib/tools/spatial_sim.js [iterations] [enemy]
//
// This is Stage 1 (CLI batch). Stage 2/3 layer a per-turn trace + a visual replay
// on the same runSpatialBattle core (see TODO at the bottom).
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as { silent?: boolean }).silent = true;

import Weapon from '../weapon/weapon.js';
import { loadEnemy, buildWeaponInfo } from '../combat/enemy_loader.js';
import { CombatSession, Combatant, CombatantMeta, Team } from '../combat/combat_session.js';
import { CombatantState } from '../combat/combatant_state.js';
import { resolveIntents } from '../combat/resolution.js';
import { choosePlan, predictPlayerTiles, PlanCandidate } from '../combat/ai_planner.js';
import { BoardConfig, Pos } from '../combat/board.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEAPONS = join(__dirname, '../../database/weapons');
const ENEMIES = join(__dirname, '../../database/enemies');

const MAX_ROUNDS = 60;
const BOARD_W = 12, BOARD_H = 10;
const MOVE_RANGE = 2;              // matches the live hunt
const DIST_MIN = 6, DIST_MAX = 8;  // enemy spawn distance from player

const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const cheb = (a: Pos, b: Pos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// A representative hunt board: player in the top-left box, enemy 6-8 away, a
// scatter of obstacles avoiding a 3x3 around each spawn. (Stage 1 keeps its own
// generator; sharing the server's randomHuntBoard is a later cleanup.)
function genBoard(): { board: BoardConfig; playerSpawn: Pos; enemySpawn: Pos } {
  const playerSpawn = { x: ri(0, 4), y: ri(0, BOARD_H - 1) };
  let enemySpawn = { x: BOARD_W - 1, y: playerSpawn.y };
  for (let tries = 0; tries < 200; tries++) {
    const c = { x: ri(0, BOARD_W - 1), y: ri(0, BOARD_H - 1) };
    const d = cheb(c, playerSpawn);
    if (d >= DIST_MIN && d <= DIST_MAX) { enemySpawn = c; break; }
  }
  const avoid = new Set<string>();
  for (const s of [playerSpawn, enemySpawn])
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) avoid.add(`${s.x + dx},${s.y + dy}`);
  const obstacles: { pos: Pos; state: 'intact' }[] = [];
  let guard = 0;
  while (obstacles.length < 8 && guard++ < 200) {
    const p = { x: ri(0, BOARD_W - 1), y: ri(0, BOARD_H - 1) };
    const k = `${p.x},${p.y}`;
    if (avoid.has(k) || obstacles.some(o => o.pos.x === p.x && o.pos.y === p.y)) continue;
    obstacles.push({ pos: p, state: 'intact' });
  }
  return { board: { width: BOARD_W, height: BOARD_H, obstacles }, playerSpawn, enemySpawn };
}

// Build a player Combatant + meta from a weapon (mirrors the live hunt player).
function buildPlayerUnit(weapon: Weapon, pos: Pos): { combatant: Combatant; meta: CombatantMeta } {
  const state = new CombatantState('Player', weapon.hp || 1, weapon.resource_name, weapon.resource_max);
  const combatant: Combatant = {
    id: 'player-1', name: 'Player', hp: weapon.hp, maxHp: weapon.hp,
    resource: weapon.resource_max, maxResource: weapon.resource_max, resourceName: weapon.resource_name,
    pos: { ...pos }, movementRange: MOVE_RANGE, isAI: false, teamId: 'team-a',
    weaponInfo: buildWeaponInfo(weapon), weight: weapon.weight, initiative: 0, initiativeRank: 0,
  };
  return { combatant, meta: { weapon, state, pattern: [], patternIndex: 0 } };
}

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
  return {
    winRate: a.win / n,
    avgRounds: a.rounds / n,
    avgHpOnWin: a.win ? a.hpOnWin / a.win : 0,
    timeoutRate: a.timeout / n,
  };
}

// --- CLI ---
// Debug: `node spatial_sim.js debug <enemy> <weapon>` traces ONE battle turn-by-turn.
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

// Replay: `node spatial_sim.js replay <enemy> <weapon> [outfile]` records ONE
// battle's full per-turn trace (heatmap + every candidate score) to JSON for the
// dev replay page. Defaults to public/replay.json so /replay.html can fetch it.
if (process.argv[2] === 'replay') {
  const enemyName = process.argv[3] ?? 'golnosar';
  const weaponName = process.argv[4] ?? 'battle_axe';
  const outFile = process.argv[5] ?? join(__dirname, '../../public/replay.json');
  const enemyPath = join(ENEMIES, `${enemyName}.yaml`);
  const weapon = Weapon.from_file(join(WEAPONS, `${weaponName}.yaml`));
  const { board, playerSpawn, enemySpawn } = genBoard();
  const player = buildPlayerUnit(weapon, playerSpawn);
  const enemy = loadEnemy(enemyPath, { id: 'enemy-1', teamId: 'team-b', pos: enemySpawn, movementRange: MOVE_RANGE });
  const teams: Team[] = [
    { id: 'team-a', name: 'Player', combatants: [player.combatant] },
    { id: 'team-b', name: 'Enemy', combatants: [enemy.combatant] },
  ];
  const session = new CombatSession('replay', board, teams);
  session.meta.set('player-1', player.meta);
  session.meta.set('enemy-1', enemy.meta);
  session.phase = 'intent';

  const nameOf = (m: CombatantMeta, t: string, i: number) => (m.weapon as unknown as Record<string, { name: string }[]>)[t]?.[i]?.name ?? t;
  const turns: unknown[] = [];
  let winner: string | null = null;
  let rounds = 0;
  for (let n = 0; n < MAX_ROUNDS; n++) {
    if (session.teams.some(t => t.combatants.length === 0)) break;
    const boardSnap = session.board.toJSON();
    const units = session.combatants.map(c => {
      const m = session.meta.get(c.id)!;
      return { id: c.id, name: c.name, team: c.teamId, pos: { ...c.pos }, hp: m.state.health, maxHp: c.maxHp, resource: m.state.resource_current, maxResource: c.maxResource };
    });
    const intents = new Map<string, ReturnType<typeof choosePlan>>();
    const decisions: unknown[] = [];
    for (const c of session.combatants) {
      const foes = session.combatants.filter(o => o.teamId !== c.teamId);
      const cands: PlanCandidate[] = [];
      const intent = choosePlan(c, session, foes.length ? cands : undefined);
      intents.set(c.id, intent);
      if (!foes.length) continue;
      const foe = foes.reduce((a, b) => cheb(c.pos, a.pos) <= cheb(c.pos, b.pos) ? a : b);
      const m = session.meta.get(c.id)!;
      const predicted = [...predictPlayerTiles(c, foe, session)].map(([k, w]) => { const [x, y] = k.split(',').map(Number); return { x, y, w }; });
      cands.sort((a, b) => b.score - a.score);
      decisions.push({
        unit: c.id, foe: foe.id, predicted,
        chosen: { moveTo: intent.moveTo, choice: intent.action.type, action: intent.action.type === 'pass' ? 'pass' : nameOf(m, intent.action.type, intent.action.actionIndex), target: intent.action.targetPos },
        candidates: cands.slice(0, 14),
      });
    }
    const { log, winner: w } = resolveIntents(session, intents);
    turns.push({ n: n + 1, board: boardSnap, units, decisions, log });
    rounds = n + 1;
    if (w) { winner = w; break; }
  }
  fs.writeFileSync(outFile, JSON.stringify({ meta: { weapon: weapon.name, enemy: enemyName, board: { width: board.width, height: board.height } }, turns, result: { winner, rounds } }));
  console.log(`wrote ${turns.length} turns -> ${outFile}  (winner: ${winner ?? 'timeout'}, ${rounds} rounds)`);
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

// TODO Stage 2/3: thread an optional trace through choosePlan (predicted heatmap +
// per-candidate scores), have runSpatialBattle emit a per-turn replay JSON, and a
// dev page that replays it through the live board renderer with score overlays +
// manual action override.
