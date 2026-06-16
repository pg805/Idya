// Shared spatial-sim core: board generation, building a player unit from a
// weapon, and generateReplay() — one battle with the full per-turn AI trace
// (predicted-movement heatmap + every scored candidate plan). Used by both the
// CLI (tools/spatial_sim.ts) and the dev API (/api/dev/replay → the dev replay
// view). The AI (choosePlan) drives BOTH sides.
import Weapon from '../weapon/weapon.js';
import { loadEnemy, buildWeaponInfo } from './enemy_loader.js';
import { CombatSession, Combatant, CombatantMeta, Team } from './combat_session.js';
import { CombatantState } from './combatant_state.js';
import { resolveIntents } from './resolution.js';
import { choosePlan, predictPlayerTiles, PlanCandidate } from './ai_planner.js';
import { computeTelegraph } from './telegraph.js';
import { BoardConfig, Pos } from './board.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const levelOf = (file: string) => (yaml.load(fs.readFileSync(file, 'utf8')) as { Level?: number }).Level ?? 0;

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEAPONS = join(__dirname, '../../database/weapons');
const ENEMIES = join(__dirname, '../../database/enemies');

export const MAX_ROUNDS = 60;
export const BOARD_W = 12, BOARD_H = 10;
export const MOVE_RANGE = 2;
const DIST_MIN = 6, DIST_MAX = 8;

const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const cheb = (a: Pos, b: Pos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// A representative hunt board: player top-left, enemy 6-8 away, scattered
// obstacles avoiding a 3x3 around each spawn.
export function genBoard(): { board: BoardConfig; playerSpawn: Pos; enemySpawn: Pos } {
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
    if (avoid.has(`${p.x},${p.y}`) || obstacles.some(o => o.pos.x === p.x && o.pos.y === p.y)) continue;
    obstacles.push({ pos: p, state: 'intact' });
  }
  return { board: { width: BOARD_W, height: BOARD_H, obstacles }, playerSpawn, enemySpawn };
}

// Build a player Combatant + meta from a weapon (mirrors the live hunt player).
export function buildPlayerUnit(weapon: Weapon, pos: Pos): { combatant: Combatant; meta: CombatantMeta } {
  const state = new CombatantState('Player', weapon.hp || 1, weapon.resource_name, weapon.resource_max);
  const combatant: Combatant = {
    id: 'player-1', name: 'Player', hp: weapon.hp, maxHp: weapon.hp,
    resource: weapon.resource_max, maxResource: weapon.resource_max, resourceName: weapon.resource_name,
    pos: { ...pos }, size: 1, movementRange: MOVE_RANGE, isAI: false, teamId: 'team-a',
    weaponInfo: buildWeaponInfo(weapon), weight: weapon.weight, initiative: 0, initiativeRank: 0,
  };
  return { combatant, meta: { weapon, state, pattern: [], patternIndex: 0 } };
}

const nameOf = (m: CombatantMeta, t: string, i: number) =>
  (m.weapon as unknown as Record<string, { name: string }[]>)[t]?.[i]?.name ?? t;

export interface ReplayData {
  meta: { weapon: string; weaponLevel: number; enemy: string; enemyLevel: number; board: { width: number; height: number } };
  turns: unknown[];
  result: { winner: string | null; rounds: number };
}

// Run ONE battle and capture per turn: the board, units, each unit's decision
// (predicted heatmap + top scored candidates + chosen plan), and the resolve log.
export function generateReplay(weaponName: string, enemyName: string): ReplayData {
  const weapon = Weapon.from_file(join(WEAPONS, `${weaponName}.yaml`));
  const enemyPath = join(ENEMIES, `${enemyName}.yaml`);
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

  const turns: unknown[] = [];
  let winner: string | null = null;
  let rounds = 0;

  const snap = (c: Combatant, hp: number, res: number, tg: string) => ({
    id: c.id, name: c.name, team: c.teamId, pos: { ...c.pos }, hp, maxHp: c.maxHp,
    resource: res, maxResource: c.maxResource, resourceName: c.resourceName, telegraph: tg,
    initiative: c.initiative, initiativeRank: c.initiativeRank,
  });

  for (let n = 0; n < MAX_ROUNDS; n++) {
    if (session.teams.some(t => t.combatants.length === 0)) break;
    const boardSnap = session.board.toJSON();
    const units = session.combatants.map(c => {
      const m = session.meta.get(c.id)!;
      const enemies = session.combatants.filter(o => o.teamId !== c.teamId);
      return snap(c, m.state.health, m.state.resource_current, computeTelegraph(m, c, enemies, session));
    });
    const intents = new Map<string, ReturnType<typeof choosePlan>>();
    const decisions: unknown[] = [];
    for (const c of session.combatants) {
      const foes = session.combatants.filter(o => o.teamId !== c.teamId);
      const cands: PlanCandidate[] = [];
      const intent = choosePlan(c, session, foes.length ? cands : undefined, c.teamId === 'team-a');
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

  // Final frame: the post-resolution end state (the killing blow is applied here),
  // so the last view shows 0 HP on the loser instead of the pre-blow snapshot.
  const finalUnits = [
    ...session.combatants.map(c => snap(c, session.meta.get(c.id)!.state.health, session.meta.get(c.id)!.state.resource_current, '')),
    ...session.deadCombatants.map(d => snap(d.combatant, 0, d.meta.state.resource_current, '')),
  ].sort((a, b) => (a.team === b.team ? 0 : a.team === 'team-a' ? -1 : 1));
  turns.push({
    n: rounds + 1, board: session.board.toJSON(), units: finalUnits, decisions: [],
    log: [winner ? `${winner === 'team-a' ? 'Player' : 'Enemy'} wins — battle over.` : 'Round cap reached — timeout.'],
  });

  return {
    meta: {
      weapon: weapon.name, weaponLevel: levelOf(join(WEAPONS, `${weaponName}.yaml`)),
      enemy: enemyName, enemyLevel: levelOf(enemyPath),
      board: { width: board.width, height: board.height },
    },
    turns, result: { winner, rounds },
  };
}

// --- Headless batch (shared by the CLI sweep and the dev matrix page) ---

export type Outcome = 'win' | 'loss' | 'timeout';
export interface BattleResult { outcome: Outcome; rounds: number; playerHpFrac: number; }

// One battle: choosePlan drives both teams every turn until a wipe or the cap.
// The player side (team-a) plays SMART (cornering anti-kite) — it stands in for a
// competent human; the enemy uses the base, shippable AI.
export function runSpatialBattle(weapon: Weapon, enemyPath: string): BattleResult {
  const { board, playerSpawn, enemySpawn } = genBoard();
  const player = buildPlayerUnit(weapon, playerSpawn);
  const enemy = loadEnemy(enemyPath, { id: 'enemy-1', teamId: 'team-b', pos: enemySpawn, movementRange: MOVE_RANGE });
  const session = new CombatSession('sim', board, [
    { id: 'team-a', name: 'Player', combatants: [player.combatant] },
    { id: 'team-b', name: 'Enemy', combatants: [enemy.combatant] },
  ]);
  session.meta.set('player-1', player.meta);
  session.meta.set('enemy-1', enemy.meta);
  session.phase = 'intent';
  const hpFrac = () => (session.meta.get('player-1')?.state.health ?? 0) / (weapon.hp || 1);
  let rounds = 0;
  for (; rounds < MAX_ROUNDS; rounds++) {
    if (session.teams.some(t => t.combatants.length === 0)) break;
    const intents = new Map(session.combatants.map(c => [c.id, choosePlan(c, session, undefined, c.teamId === 'team-a')]));
    const { winner } = resolveIntents(session, intents);
    if (winner) return { outcome: winner === 'team-a' ? 'win' : 'loss', rounds: rounds + 1, playerHpFrac: hpFrac() };
  }
  return { outcome: 'timeout', rounds, playerHpFrac: hpFrac() };
}

export interface Stats { winRate: number; avgRounds: number; avgHpOnWin: number; timeoutRate: number; }
export function aggregate(results: BattleResult[]): Stats {
  let win = 0, timeout = 0, rounds = 0, hpOnWin = 0;
  for (const r of results) {
    rounds += r.rounds;
    if (r.outcome === 'win') { win++; hpOnWin += r.playerHpFrac; }
    else if (r.outcome === 'timeout') timeout++;
  }
  const n = results.length || 1;
  return { winRate: win / n, avgRounds: rounds / n, avgHpOnWin: win ? hpOnWin / win : 0, timeoutRate: timeout / n };
}

export interface MatrixResult {
  weapons: { name: string; level: number }[];
  enemies: { name: string; level: number }[];
  cells: Record<string, Record<string, Stats>>;  // weaponName → enemyName → stats
}

// Full weapon×enemy sweep, N battles per matchup. Heavy — keep N modest for the API.
export function runMatrix(N: number): MatrixResult {
  const wf = fs.readdirSync(WEAPONS).filter(f => f.endsWith('.yaml'));
  const ef = fs.readdirSync(ENEMIES).filter(f => f.endsWith('.yaml') && f !== 'tutorial_swallow.yaml');
  const weapons = wf.map(f => ({ file: f, name: Weapon.from_file(join(WEAPONS, f)).name, level: levelOf(join(WEAPONS, f)) }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const enemies = ef.map(f => ({ file: f, name: f.replace('.yaml', ''), level: levelOf(join(ENEMIES, f)) }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  const cells: Record<string, Record<string, Stats>> = {};
  for (const w of weapons) {
    const weapon = Weapon.from_file(join(WEAPONS, w.file));
    cells[w.name] = {};
    for (const e of enemies) cells[w.name][e.name] = aggregate(Array.from({ length: N }, () => runSpatialBattle(weapon, join(ENEMIES, e.file))));
  }
  return { weapons: weapons.map(w => ({ name: w.name, level: w.level })), enemies: enemies.map(e => ({ name: e.name, level: e.level })), cells };
}
