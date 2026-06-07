// Spatial smoke test for the 0.2.0 tile/obstacle engine. Builds tiny sessions
// and drives resolveIntents directly to verify each board effect fires.
//   node ./lib/tools/test_tiles.js
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as any).silent = true;

import { CombatSession, Combatant, CombatantMeta, Team } from '../combat/combat_session.js';
import { CombatantState } from '../combat/combatant_state.js';
import { resolveIntents } from '../combat/resolution.js';
import { buildWeaponInfo } from '../combat/enemy_loader.js';
import { CombatIntent } from '../combat/intent.js';
import { BoardConfig, Pos } from '../combat/board.js';
import Weapon from '../weapon/weapon.js';
import yaml from 'js-yaml';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const W = join(__dirname, '../../database/weapons');
const E = join(__dirname, '../../database/enemies');

let pass = 0, fail = 0;
const check = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ FAIL: ${msg}`); } };

// always-5 reactive striker, infinite resource, lots of HP
const STRIKER = Weapon.from_json({
  Name: 'Striker', Description: '', HP: 99, Weight: 0,
  Resource: { Name: 'En', Max: 99 },
  Defend: [], 'Defend Crit': [],
  Attack: [{ Name: 'Jab', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [5, 5, 5], Cost: 0, Aimed: false, Range: 1, Action_String: '<User> jabs <Target> for <Damage>.' }],
  'Attack Crit': [], Special: [], 'Special Crit': [],
} as any);

const enemyWeapon = (file: string) => Weapon.from_json((yaml.load(fs.readFileSync(join(E, file), 'utf-8')) as any).Weapon);

function mk(id: string, teamId: string, pos: Pos, weapon: Weapon, isAI: boolean): { c: Combatant; m: CombatantMeta } {
  const state = new CombatantState(id, weapon.hp || 50, weapon.resource_name, weapon.resource_max);
  const c: Combatant = {
    id, name: id, hp: state.health, maxHp: state.max_health, resource: weapon.resource_max,
    maxResource: weapon.resource_max, resourceName: weapon.resource_name, pos: { ...pos },
    movementRange: 4, isAI, teamId, weaponInfo: buildWeaponInfo(weapon), weight: 0, initiative: 0, initiativeRank: 0,
  };
  return { c, m: { weapon, state, pattern: [], patternIndex: 0 } };
}

function session(board: BoardConfig, units: Array<{ c: Combatant; m: CombatantMeta }>): CombatSession {
  const teams: Team[] = [
    { id: 'A', name: 'A', combatants: units.filter(u => u.c.teamId === 'A').map(u => u.c) },
    { id: 'B', name: 'B', combatants: units.filter(u => u.c.teamId === 'B').map(u => u.c) },
  ];
  const s = new CombatSession('test', board, teams);
  for (const u of units) s.meta.set(u.c.id, u.m);
  return s;
}

const act = (id: string, type: 'defend' | 'attack' | 'special' | 'pass', index: number, moveTo: Pos | null = null, targetPos: Pos | null = null): CombatIntent =>
  ({ combatantId: id, moveTo, action: { type, actionIndex: index, targetPos } });

const EMPTY: BoardConfig = { width: 8, height: 3, obstacles: [] };
const hp = (s: CombatSession, id: string) => s.meta.get(id)!.state.health;

// ---- Test 1: Block tile ----
console.log('\nBlock tile (pickaxe Hidey Hole):');
{
  const pick = Weapon.from_file(join(W, 'pickaxe.yaml'));
  const P = mk('P', 'A', { x: 1, y: 1 }, pick, false);
  const Eu = mk('E', 'B', { x: 2, y: 1 }, STRIKER, true);
  const s = session(EMPTY, [P, Eu]);
  // R1: P drops the block tile (defend 0 = Hidey Hole); E jabs (no block yet this round)
  resolveIntents(s, new Map([['P', act('P', 'defend', 0)], ['E', act('E', 'attack', 0)]]));
  const afterR1 = hp(s, 'P');
  check(afterR1 === 30 - 5, `R1: tile placed, P takes full jab (30→${afterR1})`);
  check(!!s.board.getTile({ x: 1, y: 1 }), 'block tile exists at (1,1)');
  // R2: P stands still; tile grants block 5; E jabs 5 → 0 through
  resolveIntents(s, new Map([['P', act('P', 'pass', 0)], ['E', act('E', 'attack', 0)]]));
  const afterR2 = hp(s, 'P');
  check(afterR2 === afterR1, `R2: block tile absorbs the jab (stays ${afterR2})`);
}

// ---- Test 2: Buff tile ----
console.log('\nBuff tile (pickaxe Trench Warfare, +5 to Mine):');
{
  const pick = Weapon.from_file(join(W, 'pickaxe.yaml'));
  let maxBuffed = 0, maxPlain = 0;
  for (let i = 0; i < 200; i++) {
    const P = mk('P', 'A', { x: 1, y: 1 }, pick, false);
    const Eu = mk('E', 'B', { x: 2, y: 1 }, STRIKER, true);
    const s = session(EMPTY, [P, Eu]);
    resolveIntents(s, new Map([['P', act('P', 'defend', 1)], ['E', act('E', 'pass', 0)]])); // place buff tile
    const before = hp(s, 'E');
    resolveIntents(s, new Map([['P', act('P', 'attack', 0)], ['E', act('E', 'pass', 0)]])); // Mine from buff tile
    maxBuffed = Math.max(maxBuffed, before - hp(s, 'E'));
  }
  // Mine field maxes at 9; +5 buff lets it exceed that
  for (let i = 0; i < 200; i++) {
    const P = mk('P', 'A', { x: 1, y: 1 }, pick, false);
    const Eu = mk('E', 'B', { x: 2, y: 1 }, STRIKER, true);
    const s = session(EMPTY, [P, Eu]);
    const before = hp(s, 'E');
    resolveIntents(s, new Map([['P', act('P', 'attack', 0)], ['E', act('E', 'pass', 0)]])); // Mine, no tile
    maxPlain = Math.max(maxPlain, before - hp(s, 'E'));
  }
  check(maxPlain <= 9, `plain Mine max ≤ 9 (saw ${maxPlain})`);
  check(maxBuffed > 9, `buffed Mine exceeds 9 (saw ${maxBuffed})`);
}

// ---- Test 3: Hazard tile ----
console.log('\nHazard tile (move onto enemy hazard):');
{
  const P = mk('P', 'A', { x: 1, y: 1 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 6, y: 1 }, STRIKER, true);
  const s = session(EMPTY, [P, Eu]);
  s.board.setTile({ pos: { x: 3, y: 1 }, teamId: 'B', kind: 'hazard', value: 5 });
  const before = hp(s, 'P');
  resolveIntents(s, new Map([['P', act('P', 'pass', 0, { x: 3, y: 1 })], ['E', act('E', 'pass', 0)]])); // P moves onto hazard
  check(s.combatants.find(c => c.id === 'P')!.pos.x === 3, 'P moved onto (3,1)');
  check(hp(s, 'P') === before - 5, `P took hazard damage (${before}→${hp(s, 'P')})`);
}

// ---- Test 4: Destroy obstacle + AOE ----
console.log('\nDestroy obstacle (axe Tree Chop):');
{
  const axe = Weapon.from_file(join(W, 'axe_wood.yaml'));
  const board: BoardConfig = { width: 8, height: 3, obstacles: [{ pos: { x: 3, y: 1 }, state: 'intact' }] };
  const P = mk('P', 'A', { x: 2, y: 1 }, axe, false);          // dist 1 to obstacle
  const Eu = mk('E', 'B', { x: 3, y: 0 }, STRIKER, true);      // within 1 of obstacle (chebyshev 1)
  const s = session(board, [P, Eu]);
  const before = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'special', 1, null, { x: 3, y: 1 })], ['E', act('E', 'pass', 0)]])); // Tree Chop the obstacle
  check(s.board.getObstacle({ x: 3, y: 1 })!.state === 'destroyed', 'obstacle destroyed');
  check(hp(s, 'E') < before, `adjacent enemy took AOE (${before}→${hp(s, 'E')})`);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
