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
import { PatternActionType } from '../infrastructure/pattern.js';
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

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
