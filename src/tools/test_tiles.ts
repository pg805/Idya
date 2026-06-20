// Spatial smoke test for the 0.2.0 tile/obstacle engine. Builds tiny sessions
// and drives resolveIntents directly to verify each board effect fires.
//   node ./lib/tools/test_tiles.js
import logger from '../utility/logger.js';
for (const t of logger.transports) (t as any).silent = true;

import { CombatSession, Combatant, CombatantMeta, Team } from '../combat/combat_session.js';
import { CombatantState } from '../combat/combatant_state.js';
import { resolveIntents } from '../combat/resolution.js';
import { reachableTiles, findPath } from '../combat/movement.js';
import { effectiveMove } from '../combat/combatant_state.js';
import { generateAIIntent } from '../combat/ai.js';
import { choosePlan } from '../combat/ai_planner.js';
import { PatternActionType } from '../infrastructure/pattern.js';
import { buildWeaponInfo } from '../combat/enemy_loader.js';
import { CombatIntent } from '../combat/intent.js';
import { BoardConfig, Pos, chebyshevDist } from '../combat/board.js';
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

// Carry the enemy's top-level Health onto the weapon so test combatants get their
// real HP (the Weapon block has no HP field). Otherwise maxHp is bogus and anything
// that reads it — e.g. a heal's missing-HP — breaks.
const enemyWeapon = (file: string) => {
  const data = yaml.load(fs.readFileSync(join(E, file), 'utf-8')) as any;
  return Weapon.from_json({ ...data.Weapon, HP: data.Health });
};

function mk(id: string, teamId: string, pos: Pos, weapon: Weapon, isAI: boolean, size = 1): { c: Combatant; m: CombatantMeta } {
  const state = new CombatantState(id, weapon.hp || 50, weapon.resource_name, weapon.resource_max);
  const c: Combatant = {
    id, name: id, hp: state.health, maxHp: state.max_health, resource: weapon.resource_max,
    maxResource: weapon.resource_max, resourceName: weapon.resource_name, pos: { ...pos }, size,
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

// ---- Test 5: Aimed hazard placed under a foe triggers on drop ----
console.log('\nAimed hazard placed under a foe (Talwyrm Crystal Remnants):');
{
  const wyrm = enemyWeapon('talwyrm.yaml');
  const P = mk('P', 'A', { x: 3, y: 1 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 5, y: 1 }, wyrm, true);
  const s = session(EMPTY, [P, Eu]);
  const before = hp(s, 'P');
  resolveIntents(s, new Map([['P', act('P', 'pass', 0)], ['E', act('E', 'special', 1, null, { x: 3, y: 1 })]]));
  check(!!s.board.getTile({ x: 3, y: 1 }), 'hazard placed at the targeted tile (3,1)');
  check(hp(s, 'P') === before - 5, `hazard erupts under P on drop (${before}→${hp(s, 'P')})`);
}

// ---- Test 6: Slow tile (movement cost) ----
console.log('\nSlow tile (leaving costs +1):');
{
  const s = session(EMPTY, []);
  const plain = reachableTiles({ x: 2, y: 1 }, 2, s.board, new Set());
  check(plain.has('4,1'), 'control: (4,1) reachable at range 2 (no slow)');
  s.board.setTile({ pos: { x: 2, y: 1 }, teamId: 'A', kind: 'slow', value: 2 });
  const slowed = reachableTiles({ x: 2, y: 1 }, 2, s.board, new Set());
  check(slowed.has('3,1'), 'slow: dist-1 still reachable (step costs 2)');
  check(!slowed.has('4,1'), 'slow: dist-2 no longer reachable (leave +1 ate the budget)');
}

// ---- Test 7: Bloodmire drops a 2x2 of slow tiles ----
console.log('\nBloodmire 2x2 slow placement (Maetoad):');
{
  const toad = enemyWeapon('maetoad.yaml');
  const P = mk('P', 'A', { x: 2, y: 1 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 5, y: 1 }, toad, true);
  const s = session(EMPTY, [P, Eu]);
  resolveIntents(s, new Map([['P', act('P', 'pass', 0)], ['E', act('E', 'special', 2, null, { x: 2, y: 1 })]])); // Bloodmire = special 2
  // caster E is at (5,1), so the 2x2 sprays away (toward -x): (2,1),(1,1),(2,2),(1,2)
  const cells = ['2,1', '1,1', '2,2', '1,2'];
  const slowCount = cells.filter(k => { const [x, y] = k.split(',').map(Number); const t = s.board.getTile({ x, y }); return t && t.kind === 'slow'; }).length;
  check(slowCount === 4, `2x2 sprays away from caster, 4 slow tiles (got ${slowCount})`);
  check(!s.board.getTile({ x: 3, y: 1 }), 'no tile toward the caster (3,1) empty');
}

// ---- Test 9: obstacle blocks a sprayed tile ----
console.log('\nObstacle blocks a sprayed tile:');
{
  const toad = enemyWeapon('maetoad.yaml');
  const board: BoardConfig = { width: 8, height: 3, obstacles: [{ pos: { x: 1, y: 1 }, state: 'intact' }] };
  const P = mk('P', 'A', { x: 0, y: 0 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 5, y: 1 }, toad, true);
  const s = session(board, [P, Eu]);
  resolveIntents(s, new Map([['P', act('P', 'pass', 0)], ['E', act('E', 'special', 2, null, { x: 2, y: 1 })]]));
  check(!s.board.getTile({ x: 1, y: 1 }), 'no slow tile on the obstacle square (1,1)');
  const placed = ['2,1', '1,1', '2,2', '1,2'].filter(k => { const [x, y] = k.split(',').map(Number); return !!s.board.getTile({ x, y }); }).length;
  check(placed === 3, `3 of 4 cells placed, obstacle skipped (got ${placed})`);
}

// ---- Test 8: Rain 3x3 AoE DOT hits everyone in the zone ----
console.log('\nRain 3x3 AoE DOT (Daefen Deer):');
{
  const deer = enemyWeapon('daefen_deer.yaml');
  const P1 = mk('P1', 'A', { x: 2, y: 1 }, STRIKER, false);
  const P2 = mk('P2', 'A', { x: 3, y: 1 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 6, y: 1 }, deer, true);
  const s = session(EMPTY, [P1, P2, Eu]);
  resolveIntents(s, new Map([['P1', act('P1', 'pass', 0)], ['P2', act('P2', 'pass', 0)], ['E', act('E', 'special', 0, null, { x: 3, y: 1 })]])); // Rain = special 0
  check(s.meta.get('P1')!.state.dot.rounds > 0, 'P1 caught the Rain DOT (in 3x3)');
  check(s.meta.get('P2')!.state.dot.rounds > 0, 'P2 caught the Rain DOT (in 3x3)');
}

// ---- Test 10: an obstacle shields an AoE victim (LOS from caster) ----
console.log('\nObstacle shields an AoE victim (Rain):');
{
  const deer = enemyWeapon('daefen_deer.yaml');
  const board: BoardConfig = { width: 8, height: 3, obstacles: [{ pos: { x: 3, y: 1 }, state: 'intact' }] };
  const Eu = mk('E', 'B', { x: 1, y: 0 }, deer, true);
  const clear = mk('Pc', 'A', { x: 4, y: 0 }, STRIKER, false);   // target tile, LOS clear
  const blocked = mk('Pb', 'A', { x: 4, y: 1 }, STRIKER, false); // in zone, but obstacle (3,1) on the line
  const s = session(board, [clear, blocked, Eu]);
  resolveIntents(s, new Map([['Pc', act('Pc', 'pass', 0)], ['Pb', act('Pb', 'pass', 0)], ['E', act('E', 'special', 0, null, { x: 4, y: 0 })]]));
  check(s.meta.get('Pc')!.state.dot.rounds > 0, 'clear victim caught the Rain');
  check(s.meta.get('Pb')!.state.dot.rounds === 0, 'shielded victim (behind obstacle) was NOT hit');
}

// ---- Test 11: AoE attack into a Special crits ----
console.log('\nAoE attack into a Special crits (Mace Slam):');
{
  const mace = Weapon.from_file(join(W, 'mace.yaml'));
  const toadW = enemyWeapon('maetoad.yaml');   // has specials to set intent type
  const P = mk('P', 'A', { x: 2, y: 1 }, mace, false);
  const Eu = mk('E', 'B', { x: 3, y: 1 }, toadW, true);
  const s = session(EMPTY, [P, Eu]);
  const before = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'attack', 0, null, { x: 3, y: 1 })], ['E', act('E', 'special', 0, null, { x: 2, y: 1 })]]));
  check(s.meta.get('P')!.state.attack_crits > 0, 'AoE attack into a Special triggers the crit');
  check(before - hp(s, 'E') > 0, 'AoE target took damage');
}

// ---- Test 12: aimed tile with out-of-range target lands in range, never under self ----
console.log('\nAimed slow, out-of-range target → random in-range square, not under self (Maetoad):');
{
  const toad = enemyWeapon('maetoad.yaml');
  let underSelf = 0, placedSomething = 0;
  for (let i = 0; i < 200; i++) {
    const P = mk('P', 'A', { x: 0, y: 1 }, STRIKER, false);
    const Eu = mk('E', 'B', { x: 7, y: 2 }, toad, true);   // caster in the corner
    const s = session({ width: 8, height: 3, obstacles: [] }, [P, Eu]);
    // Bloodmire (special 2) range 3; target (0,1) is dist 7 → out of range → random fallback
    resolveIntents(s, new Map([['P', act('P', 'pass', 0)], ['E', act('E', 'special', 2, null, { x: 0, y: 1 })]]));
    if (s.board.getTile({ x: 7, y: 2 })) underSelf++;
    let any = false;
    for (let x = 0; x < 8 && !any; x++) for (let y = 0; y < 3 && !any; y++) if (s.board.getTile({ x, y })) any = true;
    if (any) placedSomething++;
  }
  check(underSelf === 0, `never drops the zone under the caster (saw ${underSelf}/200)`);
  check(placedSomething === 200, `always places the zone somewhere in range (saw ${placedSomething}/200)`);
}

// ---- Test 12b: hazard damage applies per square crossed when forced through ----
console.log('\nHazard damage applies per square crossed when forced through (Dig Trap line):');
{
  // Wall off y=0 and y=2 across x=1..3 so the only route to (3,1) is the hazard line.
  const walls = [1, 2, 3].flatMap(x => [{ pos: { x, y: 0 }, state: 'intact' as const }, { pos: { x, y: 2 }, state: 'intact' as const }]);
  const board: BoardConfig = { width: 8, height: 3, obstacles: walls };
  const P = mk('P', 'A', { x: 0, y: 1 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 7, y: 1 }, STRIKER, true);
  const s = session(board, [P, Eu]);
  for (const x of [1, 2, 3]) s.board.setTile({ pos: { x, y: 1 }, teamId: 'B', kind: 'hazard', value: 5 });
  const before = hp(s, 'P');
  resolveIntents(s, new Map([['P', act('P', 'pass', 0, { x: 3, y: 1 })], ['E', act('E', 'pass', 0)]]));
  check(s.combatants.find(c => c.id === 'P')!.pos.x === 3, 'P moved to (3,1)');
  check(hp(s, 'P') === before - 15, `P took 3 hazards crossing (1,1)(2,1)(3,1): ${before}→${hp(s, 'P')}`);
}

// ---- Test 12c: a PLAYER also routes around pits when it can ----
console.log('\nPlayer routes around pits when an open detour exists:');
{
  const P = mk('P', 'A', { x: 0, y: 1 }, STRIKER, false);   // player: isAI false
  const Eu = mk('E', 'B', { x: 7, y: 1 }, STRIKER, true);
  const s = session(EMPTY, [P, Eu]);
  for (const x of [1, 2, 3]) s.board.setTile({ pos: { x, y: 1 }, teamId: 'B', kind: 'hazard', value: 5 });
  const before = hp(s, 'P');
  resolveIntents(s, new Map([['P', act('P', 'pass', 0, { x: 3, y: 1 })], ['E', act('E', 'pass', 0)]]));
  check(s.combatants.find(c => c.id === 'P')!.pos.x === 3, 'P reached (3,1) via a detour');
  check(hp(s, 'P') === before - 5, `P dodged (1,1)/(2,1), took only the destination pit: ${before}→${hp(s, 'P')}`);
}

// ---- Test 12d: findPath mode — AI avoids, player goes cheapest (through) ----
console.log('\nfindPath: avoidHazards detours around a pit; cheapest route goes through:');
{
  const s = session(EMPTY, []);
  s.board.setTile({ pos: { x: 1, y: 1 }, teamId: 'B', kind: 'hazard', value: 15 });
  const through = findPath({ x: 0, y: 1 }, { x: 2, y: 1 }, 4, s.board, new Set(), 'A', false)!;
  const around = findPath({ x: 0, y: 1 }, { x: 2, y: 1 }, 4, s.board, new Set(), 'A', true)!;
  check(through.some(p => p.x === 1 && p.y === 1), 'cheapest route steps on the pit (1,1)');
  check(!around.some(p => p.x === 1 && p.y === 1), 'avoid route detours around the pit (1,1)');
  check(around[around.length - 1].x === 2 && around[around.length - 1].y === 1, 'both still reach (2,1)');
}

// ---- Test 13: AI routes around a slow tile when an equal-distance tile is clear ----
console.log('\nAI prefers a non-slow tile over an equal-distance slow one:');
{
  const P = mk('P', 'A', { x: 0, y: 0 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 2, y: 0 }, STRIKER, true);
  Eu.c.movementRange = 1;
  Eu.m.pattern = [{ type: PatternActionType.Attack, index: 0 }];
  const s = session(EMPTY, [P, Eu]);
  s.board.setTile({ pos: { x: 1, y: 0 }, teamId: 'A', kind: 'slow', value: 2 }); // direct step is slow
  const intent = generateAIIntent(Eu.c, s);
  // (1,0) and (1,1) are both dist 1 to target (0,0); (1,0) is slow → expect (1,1)
  check(!!intent.moveTo && intent.moveTo.x === 1 && intent.moveTo.y === 1, `routes to clear (1,1), not slow (1,0) (got ${intent.moveTo ? `(${intent.moveTo.x},${intent.moveTo.y})` : 'null'})`);
}

// ---- Test 14: AI still moves through slow when it's the only way forward ----
console.log('\nAI moves through slow when it must (only closer tile is slow):');
{
  // Wall off the flanks at x=1 so (1,1) (slow) is the only tile that closes distance.
  const board: BoardConfig = { width: 8, height: 3, obstacles: [{ pos: { x: 1, y: 0 }, state: 'intact' }, { pos: { x: 1, y: 2 }, state: 'intact' }] };
  const P = mk('P', 'A', { x: 0, y: 1 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 2, y: 1 }, STRIKER, true);
  Eu.c.movementRange = 1;
  Eu.m.pattern = [{ type: PatternActionType.Attack, index: 0 }];
  const s = session(board, [P, Eu]);
  s.board.setTile({ pos: { x: 1, y: 1 }, teamId: 'A', kind: 'slow', value: 2 });
  const intent = generateAIIntent(Eu.c, s);
  check(!!intent.moveTo && intent.moveTo.x === 1 && intent.moveTo.y === 1, `wades into slow (1,1) to advance (got ${intent.moveTo ? `(${intent.moveTo.x},${intent.moveTo.y})` : 'null'})`);
}

// ---- Test 14b: Cut Tendons caps the target's movement for its duration ----
console.log('\nMove debuff (Dagger Cut Tendons) caps reach then expires:');
{
  const dagger = Weapon.from_file(join(W, 'dagger.yaml'));
  const P = mk('P', 'A', { x: 2, y: 1 }, dagger, false);
  const Eu = mk('E', 'B', { x: 3, y: 1 }, STRIKER, true);  // adjacent, in range 2
  Eu.c.movementRange = 4;
  const s = session(EMPTY, [P, Eu]);
  const cutIdx = dagger.defend.findIndex(a => a.name === 'Cut Tendons');
  check(cutIdx >= 0, 'Cut Tendons loaded as a defend action');
  // P uses Cut Tendons (reactive, hits nearest enemy E). Applied at 4 rounds, then
  // the end-of-turn tick drops it to 3 (same as Debuff/Shield — standard).
  resolveIntents(s, new Map([['P', act('P', 'defend', cutIdx)], ['E', act('E', 'pass', 0)]]));
  check(s.meta.get('E')!.state.moveDebuff.rounds === 3, `E movement debuffed, 3 rounds left after the apply-turn tick (got ${s.meta.get('E')!.state.moveDebuff.rounds})`);
  // Crippled to move 1 (base 4): can reach dist-1 but not dist-2 this turn
  const eMove = effectiveMove(Eu.c.movementRange, s.meta.get('E')!.state);
  check(eMove === 1, `E effective move capped to 1 (got ${eMove})`);
  const reach = reachableTiles(s.combatants.find(c => c.id === 'E')!.pos, eMove, s.board, new Set(['2,1']));
  check(!reach.has('5,1'), 'crippled E cannot reach dist-2 tile (5,1)');
}

// ---- Test 14c: Push rider knocks the target back, stops at the wall ----
console.log('\nPush rider knocks target away from attacker (Wand bolt):');
{
  const wand = Weapon.from_file(join(W, 'wand.yaml'));
  const bolt = wand.attack.findIndex(a => a.push > 0);
  check(bolt >= 0, 'a wand bolt carries Push');
  // P at (1,1) hits E at (3,1) → E shoved away (+x) to (4,1)
  const P = mk('P', 'A', { x: 1, y: 1 }, wand, false);
  const Eu = mk('E', 'B', { x: 3, y: 1 }, STRIKER, true);
  const s = session(EMPTY, [P, Eu]);
  resolveIntents(s, new Map([['P', act('P', 'attack', bolt)], ['E', act('E', 'pass', 0)]]));
  check(s.combatants.find(c => c.id === 'E')!.pos.x === 4, `E knocked from x=3 to x=4 (got ${s.combatants.find(c => c.id === 'E')!.pos.x})`);

  // At the board edge the push fizzles (no shove off-board)
  const P2 = mk('P', 'A', { x: 5, y: 1 }, wand, false);
  const E2 = mk('E', 'B', { x: 7, y: 1 }, STRIKER, true);  // already at the x=7 edge (width 8)
  const s2 = session(EMPTY, [P2, E2]);
  resolveIntents(s2, new Map([['P', act('P', 'attack', bolt)], ['E', act('E', 'pass', 0)]]));
  check(s2.combatants.find(c => c.id === 'E')!.pos.x === 7, 'push fizzles at the board edge (stays x=7)');
}

// ---- Test 15: AI avoids a hazard tile when an equal-distance tile is clear ----
console.log('\nAI prefers a non-hazard tile over an equal-distance hazard one:');
{
  const P = mk('P', 'A', { x: 0, y: 0 }, STRIKER, false);
  const Eu = mk('E', 'B', { x: 2, y: 0 }, STRIKER, true);
  Eu.c.movementRange = 1;
  Eu.m.pattern = [{ type: PatternActionType.Attack, index: 0 }];
  const s = session(EMPTY, [P, Eu]);
  s.board.setTile({ pos: { x: 1, y: 0 }, teamId: 'A', kind: 'hazard', value: 15 }); // direct step is a pit
  const intent = generateAIIntent(Eu.c, s);
  // (1,0) and (1,1) both dist 1 to target (0,0); (1,0) is a hazard → expect (1,1)
  check(!!intent.moveTo && intent.moveTo.x === 1 && intent.moveTo.y === 1, `routes to clear (1,1), not hazard (1,0) (got ${intent.moveTo ? `(${intent.moveTo.x},${intent.moveTo.y})` : 'null'})`);
}

// ---- Test 16: reactive self-burst smash (Melbear Ursa Minor) — a 2×2 ground-pound ----
console.log('\nReactive self-burst smash (Melbear Ursa Minor): a 2×2 ground-pound (4×4) + flattens cover:');
{
  const bear = enemyWeapon('melbear.yaml');
  const umIdx = bear.attack.findIndex(a => a.name === 'Ursa Minor');
  check(umIdx >= 0 && bear.attack[umIdx].area === 4 && bear.attack[umIdx].smash, 'Ursa Minor is a smashing 4×4 burst');
  // Bear is 2×2 anchored at (3,1) → body {(3,1),(4,1),(3,2),(4,2)}. The 4×4 pound
  // centers on the body, covering x2..5, y0..3. Victim at (5,1) and obstacle at
  // (2,1) are both inside the ring.
  const board: BoardConfig = { width: 8, height: 5, obstacles: [{ pos: { x: 2, y: 1 }, state: 'intact' }] };
  const B = mk('E', 'B', { x: 3, y: 1 }, bear, true, 2);
  const V = mk('P', 'A', { x: 5, y: 1 }, STRIKER, false);
  const s = session(board, [B, V]);
  const before = hp(s, 'P');
  resolveIntents(s, new Map([['E', act('E', 'attack', umIdx)], ['P', act('P', 'pass', 0)]]));
  check(hp(s, 'P') < before, `victim in the ring caught the pound (${before}→${hp(s, 'P')})`);
  check(s.board.getObstacle({ x: 2, y: 1 })!.state === 'destroyed', 'obstacle in the burst was flattened');
}

// ---- Test 17: smash plows through cover (aimed AOE opens LOS) ----
console.log('\nSmash plows through cover: destroying an obstacle in the block opens LOS to the victim:');
{
  const SMASHER = Weapon.from_json({
    Name: 'Smasher', Description: '', HP: 99, Weight: 0,
    Resource: { Name: 'En', Max: 99 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Quake', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [10, 10, 10], Cost: 0, Aimed: true, Range: 2, Area: 3, Smash: true, Action_String: '<User> quakes <Target> for <Damage>.' }],
    'Attack Crit': [], Special: [], 'Special Crit': [],
  } as any);
  // Caster (2,1); obstacle (3,1) sits on the line to the victim (4,1) — without the
  // smash it would shield (cf. Test 10). The 3×3 aimed at (3,1) covers both.
  const board: BoardConfig = { width: 8, height: 3, obstacles: [{ pos: { x: 3, y: 1 }, state: 'intact' }] };
  const A = mk('P', 'A', { x: 2, y: 1 }, SMASHER, false);
  const V = mk('E', 'B', { x: 4, y: 1 }, STRIKER, true);
  const s = session(board, [A, V]);
  const before = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'attack', 0, null, { x: 3, y: 1 })], ['E', act('E', 'pass', 0)]]));
  check(s.board.getObstacle({ x: 3, y: 1 })!.state === 'destroyed', 'obstacle in the block destroyed');
  check(hp(s, 'E') < before, `victim hit through the (now levelled) cover (${before}→${hp(s, 'E')})`);
}

// ---- Test 18: Battle Axe Spinning self-burst hits multiple adjacent enemies ----
console.log('\nBattle Axe Spinning Attack: reactive 3×3 self-burst catches both flankers:');
{
  const axe = Weapon.from_file(join(W, 'battle_axe.yaml'));
  const spin = axe.special.findIndex(a => a.name === 'Spinning Attack');
  check(spin >= 0 && axe.special[spin].area === 3 && !axe.special[spin].aimed, 'Spinning Attack is a reactive 3×3 burst');
  const P = mk('P', 'A', { x: 3, y: 1 }, axe, false);
  const L = mk('L', 'B', { x: 2, y: 1 }, STRIKER, true);   // west flank
  const R = mk('R', 'B', { x: 4, y: 1 }, STRIKER, true);   // east flank
  const s = session(EMPTY, [P, L, R]);
  const bL = hp(s, 'L'), bR = hp(s, 'R');
  resolveIntents(s, new Map([['P', act('P', 'special', spin)], ['L', act('L', 'pass', 0)], ['R', act('R', 'pass', 0)]]));
  check(hp(s, 'L') < bL && hp(s, 'R') < bR, `both flankers caught the spin (L ${bL}→${hp(s, 'L')}, R ${bR}→${hp(s, 'R')})`);
}

// ---- Test 19: Push rider inside an AOE knocks a victim back ----
console.log('\nPush inside an AOE: blast damages and knocks the victim away:');
{
  const SHOCK = Weapon.from_json({
    Name: 'Shock', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 99 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Shockwave', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [10, 10, 10], Cost: 0, Aimed: true, Range: 3, Area: 3, Push: 2, Action_String: '<User> blasts <Target>.' }],
    'Attack Crit': [], Special: [], 'Special Crit': [],
  } as any);
  const P = mk('P', 'A', { x: 1, y: 1 }, SHOCK, false);
  const V = mk('E', 'B', { x: 3, y: 1 }, STRIKER, true);
  const s = session(EMPTY, [P, V]);
  const before = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'attack', 0, null, { x: 3, y: 1 })], ['E', act('E', 'pass', 0)]]));
  check(s.combatants.find(c => c.id === 'E')!.pos.x === 5, `AOE victim knocked x3→x5 (got ${s.combatants.find(c => c.id === 'E')!.pos.x})`);
  check(hp(s, 'E') < before, 'AOE victim also took the blast');
}

// ---- Test 20: crit fires per-victim inside an aimed AOE ----
console.log('\nCrit inside an aimed AOE: attacking into a victim mid-Special crits them:');
{
  const AC = Weapon.from_json({
    Name: 'AoeCrit', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 99 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Boom', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [5, 5, 5], Cost: 0, Aimed: true, Range: 3, Area: 3, Action_String: '<User> booms <Target>.' }],
    'Attack Crit': [{ Name: 'Followthrough', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [5, 5, 5], Cost: 0, Action_String: '<User> follows through.' }],
    Special: [{ Name: 'Wind', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [1, 1, 1], Cost: 0, Aimed: false, Range: 1, Action_String: '<User> winds.' }],
    'Special Crit': [],
  } as any);
  const P = mk('P', 'A', { x: 1, y: 1 }, AC, false);
  const V = mk('E', 'B', { x: 3, y: 1 }, AC, true);
  const s = session(EMPTY, [P, V]);
  // P AOE-attacks the tile on V; V is using Special → V is caught mid-wind-up → crit.
  resolveIntents(s, new Map([['P', act('P', 'attack', 0, null, { x: 3, y: 1 })], ['E', act('E', 'special', 0)]]));
  check(s.meta.get('P')!.state.attack_crits === 1, `crit fired inside the AOE (attack_crits=${s.meta.get('P')!.state.attack_crits})`);
}

// ---- Test 21: even-area reactive self-burst sprays toward the enemy ----
console.log('\nEven-area self-burst sprays toward the nearest enemy (not the NW default):');
{
  const SWEEP2 = Weapon.from_json({
    Name: 'Sweep2', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 99 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Sweep', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [10, 10, 10], Cost: 0, Aimed: false, Range: 1, Area: 2, Action_String: '<User> sweeps.' }],
    'Attack Crit': [], Special: [], 'Special Crit': [],
  } as any);
  // Enemy due east; the 2×2 has no center, so it must extend east to catch it
  // (the NW default would spray to x2..3 and whiff).
  const P = mk('P', 'A', { x: 3, y: 1 }, SWEEP2, false);
  const V = mk('E', 'B', { x: 4, y: 1 }, STRIKER, true);
  const s = session(EMPTY, [P, V]);
  const before = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'attack', 0)], ['E', act('E', 'pass', 0)]]));
  check(hp(s, 'E') < before, `even burst sprayed east onto the enemy (${before}→${hp(s, 'E')})`);
}

// ---- Test 22: smart AI — Melbear smashes at full HP, heals when hurt (the dial) ----
console.log('\nSmart AI dial (Melbear): attacks at full HP, retreats to heal when hurt:');
{
  const bear = enemyWeapon('melbear.yaml');
  const berry = bear.defend.findIndex(a => a.name === 'Berry Snack');

  // Full HP, player adjacent → should pick a damaging action, not heal.
  {
    const B = mk('E', 'B', { x: 5, y: 1 }, bear, true);
    const P = mk('P', 'A', { x: 4, y: 1 }, STRIKER, false);
    const s = session(EMPTY, [B, P]);
    const plan = choosePlan(s.combatants.find(c => c.id === 'E')!, s);
    check(plan.action.type === 'attack' || plan.action.type === 'special', `full HP → attacks (got ${plan.action.type} #${plan.action.actionIndex})`);
  }
  // About to die (a foe hit from death) → survival heal, not a suicide attack.
  // (Progress-scoring: "heal when threatened", not at a fixed HP fraction — a tank
  // at 30/300 vs a 5-dmg jab isn't in danger and rightly keeps attacking.)
  {
    const B = mk('E', 'B', { x: 5, y: 1 }, bear, true);
    const P = mk('P', 'A', { x: 4, y: 1 }, STRIKER, false);
    const s = session(EMPTY, [B, P]);
    s.meta.get('E')!.state.health = 5;
    const plan = choosePlan(s.combatants.find(c => c.id === 'E')!, s);
    check(plan.action.type === 'defend' && plan.action.actionIndex === berry, `hurt → Berry Snack heal (got ${plan.action.type} #${plan.action.actionIndex})`);
  }
}

// ---- Test 23: smart AI — a fragile ranged unit holds range instead of charging ----
console.log('\nSmart AI kiting: a fragile ranged unit does not walk into melee:');
{
  const SNIPER = Weapon.from_json({
    Name: 'Sniper', Description: '', HP: 35, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Snipe', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [10, 10, 10], Cost: 0, Aimed: false, Range: 3, Action_String: '<User> snipes <Target>.' }],
    'Attack Crit': [], Special: [], 'Special Crit': [],
  } as any);
  const E = mk('E', 'B', { x: 7, y: 1 }, SNIPER, true);   // starts at range
  const P = mk('P', 'A', { x: 4, y: 1 }, STRIKER, false);  // melee, 3 away
  const s = session(EMPTY, [E, P]);
  const plan = choosePlan(s.combatants.find(c => c.id === 'E')!, s);
  const land = plan.moveTo ?? { x: 7, y: 1 };
  check(chebyshevDist(land, { x: 4, y: 1 }) >= 2, `held range, didn't close to melee (landed dist ${chebyshevDist(land, { x: 4, y: 1 })})`);
}

// ---- Test 24: smart AI — aimed attack LEADS the advancing player, not their tile ----
console.log('\nSmart AI leads: aimed attack targets where the player is going, not where they are:');
{
  const AIMER = Weapon.from_json({
    Name: 'Aimer', Description: '', HP: 40, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Lob', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [12, 12, 12], Cost: 0, Aimed: true, Range: 5, Action_String: '<User> lobs at <Target>.' }],
    'Attack Crit': [], Special: [], 'Special Crit': [],
  } as any);
  const E = mk('E', 'B', { x: 6, y: 1 }, AIMER, true);
  const P = mk('P', 'A', { x: 1, y: 1 }, STRIKER, false);  // will advance toward (6,1)
  P.c.movementRange = 4;
  const s = session(EMPTY, [E, P]);
  const plan = choosePlan(s.combatants.find(c => c.id === 'E')!, s);
  check(!!plan.action.targetPos && plan.action.targetPos.x > 1, `aimed ahead of the player's tile (target x=${plan.action.targetPos?.x}, player at x=1)`);
}

// ---- Test 25: planner is deterministic ----
console.log('\nSmart AI is deterministic (same board → same plan):');
{
  const bear = enemyWeapon('melbear.yaml');
  const B = mk('E', 'B', { x: 5, y: 1 }, bear, true);
  const P = mk('P', 'A', { x: 3, y: 0 }, STRIKER, false);
  const s = session(EMPTY, [B, P]);
  const a = choosePlan(s.combatants.find(c => c.id === 'E')!, s);
  const b = choosePlan(s.combatants.find(c => c.id === 'E')!, s);
  check(JSON.stringify(a) === JSON.stringify(b), 'two calls produce identical intents');
}

// A guard with a riposte: Block defend + a Strike defend-crit that hits the
// attacker. Used to verify defend ▶ attack crit engagement.
const DEFENDER = Weapon.from_json({
  Name: 'Defender', Description: '', HP: 200, Weight: 0, Resource: { Name: 'En', Max: 9 },
  Defend: [{ Name: 'Guard', Type: 2, Type_Name: 'Block', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Value: 5, Cost: 0, Range: 1, Action_String: '<User> guards.' }],
  'Defend Crit': [{ Name: 'Riposte', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [12, 12, 12], Cost: 0, Range: 1, Action_String: '<User> ripostes <Target>.' }],
  Attack: [], 'Attack Crit': [], Special: [], 'Special Crit': [],
} as any);

// ---- Test 26: defend ▶ attack crit fires when a 2×2 reactive pound CATCHES the defender ----
// Regression: critEngages must use the footprint-centered burst (selfBurstCells),
// not the old corner-spray areaBlock, or a defender west of the bear reads as
// "not affected" and the deserved counter is suppressed.
console.log('\nDefend-crit vs a 2×2 ground-pound: a defender caught in the ring counters:');
{
  const bear = enemyWeapon('melbear.yaml');   // Size 2, Ursa Minor = reactive 4×4
  const um = bear.attack.findIndex(a => a.name === 'Ursa Minor');
  // Bear 2×2 at (3,1) → body x3..4,y1..2; the 4×4 pound covers x2..5,y0..3.
  // Defender at (2,1) is WEST of the body but inside the ring (the failing case).
  const board: BoardConfig = { width: 8, height: 5, obstacles: [] };
  const B = mk('E', 'B', { x: 3, y: 1 }, bear, true, 2);
  const D = mk('P', 'A', { x: 2, y: 1 }, DEFENDER, false);
  const s = session(board, [B, D]);
  const bearBefore = hp(s, 'E');
  resolveIntents(s, new Map([['E', act('E', 'attack', um)], ['P', act('P', 'defend', 0)]]));
  check(s.meta.get('P')!.state.attack_crits === 1, 'defender countered the pound (defend-crit fired)');
  check(bearBefore - hp(s, 'E') > 0, `riposte damaged the bear (${bearBefore}→${hp(s, 'E')})`);
}

// ---- Test 27: ...but NOT when the pound misses the defender ----
console.log('\nDefend-crit does NOT fire when the pound misses (defender outside the ring):');
{
  const bear = enemyWeapon('melbear.yaml');
  const um = bear.attack.findIndex(a => a.name === 'Ursa Minor');
  const board: BoardConfig = { width: 8, height: 5, obstacles: [] };
  const B = mk('E', 'B', { x: 3, y: 1 }, bear, true, 2);
  const D = mk('P', 'A', { x: 7, y: 4 }, DEFENDER, false);   // well outside the 4×4
  const s = session(board, [B, D]);
  const bearBefore = hp(s, 'E');
  resolveIntents(s, new Map([['E', act('E', 'attack', um)], ['P', act('P', 'defend', 0)]]));
  check(s.meta.get('P')!.state.attack_crits === 0, 'no counter when the pound did not reach the defender');
  check(hp(s, 'E') === bearBefore, 'bear took no riposte');
}

// ---- Test 28: destroy-obstacle is outward — its blast engages an attack-crit ----
console.log('\nDestroy-obstacle crit: blasting a foe by the wreck (mid-Special) triggers the attack-crit:');
{
  const SHATTERER = Weapon.from_json({
    Name: 'Shatterer', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Shatter', Type: 12, Type_Name: 'Destroy Obstacle', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [10, 10, 10], Cost: 0, Aimed: true, Range: 3, Action_String: '<User> shatters the obstacle.' }],
    'Attack Crit': [{ Name: 'Splinters', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [8, 8, 8], Cost: 0, Range: 3, Action_String: '<User> follows up on <Target>.' }],
    Special: [], 'Special Crit': [],
  } as any);
  const toadW = enemyWeapon('maetoad.yaml');   // a foe with a Special to set its category
  // Attacker at (2,1) shatters the obstacle at (4,1); the foe at (5,1) is within 1
  // of the wreck → caught by the blast. Foe uses Special, attack beats special.
  const board: BoardConfig = { width: 8, height: 3, obstacles: [{ pos: { x: 4, y: 1 }, state: 'intact' }] };
  const P = mk('P', 'A', { x: 2, y: 1 }, SHATTERER, false);
  const F = mk('E', 'B', { x: 5, y: 1 }, toadW, true);
  const s = session(board, [P, F]);
  const foeBefore = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'attack', 0, null, { x: 4, y: 1 })], ['E', act('E', 'special', 0)]]));
  check(s.meta.get('P')!.state.attack_crits === 1, 'destroy-obstacle blast engaged the attack-crit');
  check(foeBefore - hp(s, 'E') > 0, `foe took blast + crit damage (${foeBefore}→${hp(s, 'E')})`);
}

// ---- Test 29: special ▶ defend crit (the third triangle leg) ----
console.log('\nSpecial-crit: a Special that lands on a guarding foe crits it (special ▶ defend):');
{
  const SMITER = Weapon.from_json({
    Name: 'Smiter', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [], 'Defend Crit': [], Attack: [], 'Attack Crit': [],
    Special: [{ Name: 'Smite', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [10, 10, 10], Cost: 0, Aimed: false, Range: 1, Action_String: '<User> smites <Target>.' }],
    'Special Crit': [{ Name: 'Echo', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [7, 7, 7], Cost: 0, Range: 1, Action_String: '<User> echoes onto <Target>.' }],
  } as any);
  const P = mk('P', 'A', { x: 2, y: 1 }, SMITER, false);
  const F = mk('E', 'B', { x: 3, y: 1 }, DEFENDER, true);   // guards (defend index 0)
  const s = session(EMPTY, [P, F]);
  const foeBefore = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'special', 0)], ['E', act('E', 'defend', 0)]]));
  check(s.meta.get('P')!.state.attack_crits === 1, 'special into a defend fired the special-crit');
  check(foeBefore - hp(s, 'E') > 0, `guarding foe took Smite + Echo (${foeBefore}→${hp(s, 'E')})`);
  // The reverse leg must NOT fire: defend beats attack, not special, so the
  // guard does not counter the Special.
  check(s.meta.get('E')!.state.attack_crits === 0 && hp(s, 'P') === 99, 'the guard did NOT counter a Special');
}

// ---- Test 30: no engagement → no crit (two inward actions) ----
console.log('\nNo crit without a real exchange: a self-heal Special vs a self-Block fires nothing:');
{
  const SELFCASTER = Weapon.from_json({
    Name: 'Selfcaster', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [], 'Defend Crit': [], Attack: [], 'Attack Crit': [],
    Special: [{ Name: 'Meditate', Type: 6, Type_Name: 'Heal', Damage_Type: 'Arcane', Damage_Subtype: 'Mental', Value: 10, Cost: 0, Action_String: '<User> meditates.' }],
    'Special Crit': [{ Name: 'Backlash', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [9, 9, 9], Cost: 0, Range: 1, Action_String: '<User> lashes <Target>.' }],
  } as any);
  const P = mk('P', 'A', { x: 2, y: 1 }, SELFCASTER, false);  // special, but self-only
  const F = mk('E', 'B', { x: 3, y: 1 }, DEFENDER, true);     // defend, self-only
  const s = session(EMPTY, [P, F]);
  const foeBefore = hp(s, 'E');
  resolveIntents(s, new Map([['P', act('P', 'special', 0)], ['E', act('E', 'defend', 0)]]));
  // Categories line up (special ▶ defend) but neither action lands on the other.
  check(s.meta.get('P')!.state.attack_crits === 0, 'no special-crit when nobody was affected');
  check(hp(s, 'E') === foeBefore, 'foe took no Backlash (the crit did not fire)');
}

// ---- Test 31: self-target crit payload lands on the actor, not the foe ----
console.log('\nSelf-target crit payload: a defend-crit heal mends the defender, doesn\'t hit the attacker:');
{
  const MEDIC = Weapon.from_json({
    Name: 'Medic', Description: '', HP: 200, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [{ Name: 'Guard', Type: 2, Type_Name: 'Block', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Value: 5, Cost: 0, Range: 1, Action_String: '<User> guards.' }],
    'Defend Crit': [{ Name: 'Second Wind', Type: 6, Type_Name: 'Heal', Damage_Type: 'Arcane', Damage_Subtype: 'Plant', Value: 20, Cost: 0, Action_String: '<User> catches a second wind.' }],
    Attack: [], 'Attack Crit': [], Special: [], 'Special Crit': [],
  } as any);
  const A = mk('E', 'B', { x: 3, y: 1 }, STRIKER, true);   // attacks (reactive Jab)
  const D = mk('P', 'A', { x: 2, y: 1 }, MEDIC, false);    // guards
  D.m.state.health = 50;                                   // hurt, so the self-heal is visible
  const s = session(EMPTY, [A, D]);
  resolveIntents(s, new Map([['E', act('E', 'attack', 0)], ['P', act('P', 'defend', 0)]]));
  check(s.meta.get('P')!.state.attack_crits === 1, 'defend-crit fired against the attacker');
  check(hp(s, 'P') > 50, `the heal landed on the defender (50→${hp(s, 'P')})`);
  check(hp(s, 'E') === 99, 'the attacker took no damage — the crit was self-targeted, not a riposte');
}

// ---- Test 32: a 2×2 mover can't slide its footprint onto a 1×1 mover ----
// Regression: both move to DIFFERENT anchors, but the bear's 2×2 footprint would
// cover the square the player also moved to. The player (priority) keeps it; the
// bear is denied rather than stacking on top of the player.
console.log('\nFootprint-overlap contest: a 2×2 may not move onto a 1×1 that also moved:');
{
  const bear = enemyWeapon('melbear.yaml');
  const board: BoardConfig = { width: 8, height: 6, obstacles: [] };
  const P = mk('P', 'A', { x: 2, y: 1 }, STRIKER, false);       // → (2,3)
  const B = mk('E', 'B', { x: 3, y: 2 }, bear, true, 2);        // → anchor (2,2): footprint covers (2,3)
  const s = session(board, [P, B]);
  resolveIntents(s, new Map([
    ['P', act('P', 'pass', 0, { x: 2, y: 3 })],
    ['E', act('E', 'pass', 0, { x: 2, y: 2 })],
  ]));
  const pp = s.combatants.find(c => c.id === 'P')!.pos;
  const bp = s.combatants.find(c => c.id === 'E')!.pos;
  check(pp.x === 2 && pp.y === 3, `player kept its square (${pp.x},${pp.y})`);
  // The bear must not cover the player's square — denied to its start, or anywhere clear.
  const bearCells = [0, 1].flatMap(dx => [0, 1].map(dy => `${bp.x + dx},${bp.y + dy}`));
  check(!bearCells.includes(`${pp.x},${pp.y}`), `bear's footprint does not overlap the player (bear @${bp.x},${bp.y})`);
}

// ---- Test 33: a MISSED attack doesn't crit just because the foe hit you ----
// Regression: the crit gate is directional. My attack whiffs (aimed at empty
// space); the foe's Special lands on me. attack ▶ special, but I didn't connect,
// so no attack-crit — even though the foe connected with me.
console.log('\nMissed attack into a Special does NOT crit (foe hit me, I missed it):');
{
  const MISSER = Weapon.from_json({
    Name: 'Misser', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [], 'Defend Crit': [],
    Attack: [{ Name: 'Lob', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [5, 5, 5], Cost: 0, Aimed: true, Range: 3, Action_String: '<User> lobs at <Target>.' }],
    'Attack Crit': [{ Name: 'Echo', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [7, 7, 7], Cost: 0, Range: 3, Action_String: '<User> echoes onto <Target>.' }],
    Special: [], 'Special Crit': [],
  } as any);
  const ZAPPER = Weapon.from_json({
    Name: 'Zapper', Description: '', HP: 99, Weight: 0, Resource: { Name: 'En', Max: 9 },
    Defend: [], 'Defend Crit': [], Attack: [], 'Attack Crit': [],
    Special: [{ Name: 'Zap', Type: 1, Type_Name: 'Strike', Damage_Type: 'Physical', Damage_Subtype: 'Blunt', Field: [5, 5, 5], Cost: 0, Aimed: false, Range: 5, Action_String: '<User> zaps <Target>.' }],
    'Special Crit': [],
  } as any);
  const board: BoardConfig = { width: 8, height: 5, obstacles: [] };
  const P = mk('P', 'A', { x: 1, y: 1 }, MISSER, false);
  const E = mk('E', 'B', { x: 3, y: 1 }, ZAPPER, true);
  const s = session(board, [P, E]);
  const foeBefore = hp(s, 'E');
  // P lobs at empty (1,3) — the foe is at (3,1), so it misses. E zaps P (reactive).
  resolveIntents(s, new Map([['P', act('P', 'attack', 0, null, { x: 1, y: 3 })], ['E', act('E', 'special', 0)]]));
  check(hp(s, 'P') < 99, `the foe's Special hit me (${hp(s, 'P')})`);
  check(s.meta.get('P')!.state.attack_crits === 0, 'no attack-crit when my attack missed the foe');
  check(hp(s, 'E') === foeBefore, 'foe took no crit damage (my attack whiffed)');
}

// ---- Test 34: soft-block — a held square is a reachable destination, not a thoroughfare ----
// Movement priority is stationary ▶ player ▶ NPC, so you can MOVE ONTO a square an
// opposing unit holds (betting it vacates) — but you can't path THROUGH it.
console.log('\nSoft-block: an enemy-held square is landable but not pathable-through:');
{
  // Corridor: obstacles at (3,0)/(3,2) seal column x=3 except the middle (3,1).
  const board: BoardConfig = { width: 8, height: 3, obstacles: [{ pos: { x: 3, y: 0 }, state: 'intact' }, { pos: { x: 3, y: 2 }, state: 'intact' }] };
  const s = session(board, []);
  const soft = new Set(['3,1']);   // an opposing unit holds the chokepoint
  const reach = reachableTiles({ x: 1, y: 1 }, 4, s.board, new Set(), 1, soft);
  check(reach.has('3,1'), 'the held square IS a reachable destination (you can bet on it)');
  check(!reach.has('4,1'), 'cannot path THROUGH the held square to (4,1) beyond it');
  const open = reachableTiles({ x: 1, y: 1 }, 4, s.board, new Set(), 1);
  check(open.has('4,1'), 'control: with the chokepoint clear, (4,1) IS reachable');
}

// ---- Test 35: the move-priority contest end-to-end (stationary ▶ player ▶ NPC) ----
console.log('\nMove onto a vacated NPC square lands; onto a stationary one is blocked:');
{
  // NPC vacates → the player (priority over a moving NPC) takes the square.
  const P = mk('P', 'A', { x: 1, y: 1 }, STRIKER, false);
  const E = mk('E', 'B', { x: 2, y: 1 }, STRIKER, true);
  const s = session(EMPTY, [P, E]);
  resolveIntents(s, new Map([
    ['P', act('P', 'pass', 0, { x: 2, y: 1 })],   // move onto the NPC's current square
    ['E', act('E', 'pass', 0, { x: 4, y: 1 })],   // NPC moves away
  ]));
  const pp = s.combatants.find(c => c.id === 'P')!.pos;
  check(pp.x === 2 && pp.y === 1, `player took the square the NPC vacated (${pp.x},${pp.y})`);

  // NPC holds → it's stationary, which outranks the player-mover; the bet fails.
  const P2 = mk('P', 'A', { x: 1, y: 1 }, STRIKER, false);
  const E2 = mk('E', 'B', { x: 2, y: 1 }, STRIKER, true);
  const s2 = session(EMPTY, [P2, E2]);
  resolveIntents(s2, new Map([
    ['P', act('P', 'pass', 0, { x: 2, y: 1 })],   // bet on the square
    ['E', act('E', 'pass', 0)],                   // NPC holds it
  ]));
  const pp2 = s2.combatants.find(c => c.id === 'P')!.pos;
  check(pp2.x === 1 && pp2.y === 1, `player blocked by the stationary NPC, holds its square (${pp2.x},${pp2.y})`);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
