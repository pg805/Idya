// Smoke tests for the real-time engine. No server, no database, no clock.
//
//   npm run build && node lib/tools/test_realtime.js
import {
  stepWorld, driveEnemy, rectHitsCircle,
  type RtUnit, type StepWorld, type AttackShape, type RtEvent,
} from '../combat/realtime.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

const THRUST: AttackShape = { reach: 1, width: 0.45, activeMs: 120, coolMs: 500, tellMs: 0, damage: 16 };
const CLAWS:  AttackShape = { reach: 1, width: 0.5,  activeMs: 140, coolMs: 1100, tellMs: 360, damage: 9 };

function unit(o: Partial<RtUnit> & { id: string; team: RtUnit['team'] }): RtUnit {
  return {
    ref: o.id, x: 5, y: 5, r: 0.34, hp: 100, maxHp: 100, speed: 4.2, vision: 0,
    attack: o.team === 'player' ? THRUST : CLAWS,
    moveX: 0, moveY: 0, aim: 0, wantAttack: false,
    phase: 'idle', tLeft: 0, cool: 0, struck: [], dead: false, throttle: 0,
    wanderX: 0, wanderY: 0, wanderMs: 0,
    ...o,
  } as RtUnit;
}
const world = (blocked: string[] = [], size = 24): StepWorld => ({ blocked: new Set(blocked), size });

/** Run n frames of dt, collecting everything that happened. */
function run(units: RtUnit[], w: StepWorld, frames: number, dt = 1 / 60): RtEvent[] {
  const all: RtEvent[] = [];
  for (let i = 0; i < frames; i++) all.push(...stepWorld(units, w, dt));
  return all;
}

console.log('\nhitbox geometry');
{
  const t = { x: 6, y: 5, r: 0.34 };
  ok('reaches straight ahead',      rectHitsCircle(5, 5, 0, 1, 0.45, t));
  ok('misses behind',              !rectHitsCircle(5, 5, Math.PI, 1, 0.45, t));
  ok('misses past its reach',      !rectHitsCircle(5, 5, 0, 0.5, 0.45, t));
  ok('misses off to the side',     !rectHitsCircle(5, 5, 0, 1, 0.45, { x: 6, y: 6, r: 0.34 }));
  ok('a thrust is narrow',         !rectHitsCircle(5, 5, 0, 1, 0.2, { x: 5.8, y: 5.45, r: 0.2 }));
  ok('a swing is wide',             rectHitsCircle(5, 5, 0, 1, 1.2, { x: 5.8, y: 5.45, r: 0.2 }));
  ok('works on the diagonal',       rectHitsCircle(5, 5, Math.PI / 4, 1, 0.45, { x: 5.6, y: 5.6, r: 0.34 }));
}

console.log('\nmovement');
{
  const u = unit({ id: 'p', team: 'player' });
  u.moveX = 1; u.moveY = 0;
  run([u], world(), 60);                       // one second
  // Short of a full second's travel by the acceleration ramp, which is the
  // point: 0.22s spent getting up to speed costs about half of it.
  ok('walks its speed in a second', u.x > 5 + 4.2 - 0.6 && u.x < 5 + 4.2,
     `x=${u.x.toFixed(2)}`);
  run([u], world(), 60);
  const second = u.x - (5 + 4.2 - 0.43);
  ok('and full speed once up to it', Math.abs(second - 4.2) < 0.15, `second ${second.toFixed(2)}`);
}
{
  // The bug the grid had: a diagonal must not be faster than a straight line.
  const a = unit({ id: 'a', team: 'player' });
  const b = unit({ id: 'b', team: 'player', x: 15 });
  a.moveX = 1; a.moveY = 0;
  b.moveX = 1; b.moveY = 1;
  run([a], world(), 60);
  run([b], world(), 60);
  const straight = a.x - 5;
  const diagonal = Math.hypot(b.x - 15, b.y - 5);
  ok('diagonal is not faster', Math.abs(straight - diagonal) < 0.05,
     `straight ${straight.toFixed(2)} vs diagonal ${diagonal.toFixed(2)}`);
}
{
  const u = unit({ id: 'p', team: 'player', x: 5.5, y: 5.5 });
  u.moveX = 1;
  run([u], world(['6,5']), 60);
  ok('stops against a solid tile', u.x < 6, `x=${u.x.toFixed(2)}`);
  ok('is not inside it',           u.x <= 6 - u.r + 1e-6, `x=${u.x.toFixed(2)}`);
}
{
  const u = unit({ id: 'p', team: 'player', x: 1, y: 5 });
  u.moveX = -1;
  run([u], world(), 60);
  ok('cannot leave the chunk', u.x >= u.r - 1e-6, `x=${u.x.toFixed(2)}`);
}
{
  const a = unit({ id: 'a', team: 'player', x: 5, y: 5 });
  const b = unit({ id: 'b', team: 'enemy',  x: 5.1, y: 5 });
  run([a, b], world(), 1);
  ok('bodies push apart', Math.hypot(b.x - a.x, b.y - a.y) > 0.6,
     `gap ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)}`);
}

console.log('\nattacks');
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy',  x: 6, y: 5, hp: 100 });
  p.aim = 0; p.wantAttack = true;
  const events = run([p, e], world(), 2);
  ok('a player attack lands at once', e.hp === 100 - THRUST.damage, `hp=${e.hp}`);
  ok('and reports a swing',           events.some(v => v.kind === 'swing'));
  ok('and reports the hit',           events.some(v => v.kind === 'hit'));
}
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy',  x: 6, y: 5 });
  p.aim = 0; p.wantAttack = true;
  run([p, e], world(), 12);                    // the whole active window
  ok('one swing lands once', e.hp === 100 - THRUST.damage, `hp=${e.hp}`);
}
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy',  x: 6, y: 5 });
  p.aim = 0;
  p.wantAttack = true; run([p, e], world(), 12);
  p.wantAttack = true; run([p, e], world(), 2);
  ok('cooldown refuses the second', e.hp === 100 - THRUST.damage, `hp=${e.hp}`);
  p.wantAttack = true; run([p, e], world(), 40);   // wait it out
  ok('and allows it once spent',    e.hp === 100 - THRUST.damage * 2, `hp=${e.hp}`);
}
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const a = unit({ id: 'a', team: 'enemy', x: 5.9, y: 4.75 });
  const b = unit({ id: 'b', team: 'enemy', x: 5.9, y: 5.25 });
  p.aim = 0; p.wantAttack = true;
  run([p, a, b], world(), 4);
  ok('a wide swing catches two', a.hp < 100 && b.hp < 100, `a=${a.hp} b=${b.hp}`);
}
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy',  x: 6, y: 5, hp: THRUST.damage });
  p.aim = 0; p.wantAttack = true;
  const events = run([p, e], world(), 4);
  ok('a killing blow reports a death', events.some(v => v.kind === 'died' && v.id === 'e'));
  ok('and the body is out',            e.dead);
}
{
  // An early press is held, not thrown away (docs/combat.md §0b).
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5, cool: 200 });
  const e = unit({ id: 'e', team: 'enemy',  x: 6, y: 5 });
  p.aim = 0; p.wantAttack = true;
  run([p, e], world(), 3);
  ok('an early press is still pending', p.wantAttack && e.hp === 100);
  run([p, e], world(), 20);
  ok('and spends when the cooldown ends', e.hp < 100, `hp=${e.hp}`);
}

console.log('\nenemies');
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy',  x: 12, y: 5, speed: 2.6 });
  let told = false;
  for (let i = 0; i < 400; i++) {
    driveEnemy(e, [p], 1000 / 60);
    for (const v of stepWorld([p, e], world(), 1 / 60)) if (v.kind === 'tell') told = true;
  }
  ok('closes the distance', Math.hypot(e.x - p.x, e.y - p.y) < 1.5,
     `gap ${Math.hypot(e.x - p.x, e.y - p.y).toFixed(2)}`);
  ok('telegraphs before striking', told);
  ok('and gets damage in',         p.hp < 100, `hp=${p.hp}`);
}
{
  // A telegraph is only worth having if it can be walked out of.
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy',  x: 6, y: 5, speed: 0 });
  driveEnemy(e, [p], 1000 / 60);
  stepWorld([p, e], world(), 1 / 60);
  ok('the wind-up starts', e.phase === 'tell');
  p.moveX = 1; p.moveY = -1;                  // leave while it winds up
  for (let i = 0; i < 40; i++) { stepWorld([p, e], world(), 1 / 60); }
  ok('dodging the wind-up works', p.hp === 100, `hp=${p.hp}`);
}
{
  // Nearest first, lowest HP to break a tie.
  const a = unit({ id: 'a', team: 'player', x: 6, y: 5, hp: 90 });
  const b = unit({ id: 'b', team: 'player', x: 6, y: 5, hp: 20 });
  const e = unit({ id: 'e', team: 'enemy',  x: 5, y: 5 });
  driveEnemy(e, [a, b], 1000 / 60);
  const aimedAt = Math.abs(e.aim) < 0.2 ? 'either' : 'elsewhere';
  ok('faces the pair', aimedAt === 'either', `aim=${e.aim.toFixed(2)}`);
}

console.log('\nthrottle');
{
  // Intent magnitude is a throttle, so a wandering body can potter.
  const full = unit({ id: 'f', team: 'player' });
  const half = unit({ id: 'h', team: 'player', x: 15 });
  full.moveX = 1;
  half.moveX = 0.4;
  run([full], world(), 60);
  run([half], world(), 60);
  const a = full.x - 5, b = half.x - 15;
  // Not exactly 0.4 over the first second: the slower one finishes its ramp
  // sooner, so it loses proportionally less to the acceleration.
  ok('a short vector moves slower', b / a > 0.35 && b / a < 0.5, `ratio ${(b / a).toFixed(2)}`);
}

console.log('\nvision');
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy', x: 18, y: 5, vision: 8, speed: 0 });
  driveEnemy(e, [p], 16);
  ok('does not notice you from far off', !e.wantAttack && e.phase === 'idle');
  p.x = 10;                                   // walk into its range
  // Turning is rate-limited, so it comes round over a few frames rather than
  // snapping to face you.
  for (let i = 0; i < 30; i++) driveEnemy(e, [p], 1000 / 60);
  ok('notices you inside its range', Math.abs(Math.abs(e.aim) - Math.PI) < 0.05,
     `aim ${e.aim.toFixed(2)}`);
}
{
  const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
  const e = unit({ id: 'e', team: 'enemy', x: 20, y: 20, vision: 6, speed: 2.6 });
  for (let i = 0; i < 300; i++) { driveEnemy(e, [p], 1000 / 60); stepWorld([p, e], world(), 1 / 60); }
  ok('out of sight means it never reaches you', Math.hypot(e.x - p.x, e.y - p.y) > 3,
     `gap ${Math.hypot(e.x - p.x, e.y - p.y).toFixed(1)}`);
  ok('and you take nothing', p.hp === 100, `hp=${p.hp}`);
}

console.log('\nwandering');
{
  const e = unit({ id: 'e', team: 'enemy', x: 12, y: 12, vision: 6, speed: 2.6 });
  const start = { x: e.x, y: e.y };
  let moved = false;
  for (let i = 0; i < 600; i++) {
    driveEnemy(e, [], 1000 / 60);
    stepWorld([e], world(), 1 / 60);
    if (Math.hypot(e.x - start.x, e.y - start.y) > 0.5) moved = true;
  }
  ok('an idle body drifts', moved);
  ok('but does not bolt', Math.hypot(e.x - start.x, e.y - start.y) < 14,
     `drifted ${Math.hypot(e.x - start.x, e.y - start.y).toFixed(1)}`);
}
{
  const e = unit({ id: 'e', team: 'enemy', x: 12, y: 12, vision: 6 });
  let swung = false;
  for (let i = 0; i < 400; i++) {
    driveEnemy(e, [], 1000 / 60);
    for (const v of stepWorld([e], world(), 1 / 60)) if (v.kind === 'swing') swung = true;
  }
  ok('and never attacks thin air', !swung);
}
{
  // Pauses are half the point: a body that never stops reads as patrolling.
  const e = unit({ id: 'e', team: 'enemy', x: 12, y: 12, vision: 6 });
  let still = 0, frames = 0;
  for (let i = 0; i < 1800; i++) {
    driveEnemy(e, [], 1000 / 60);
    frames++;
    if (e.moveX === 0 && e.moveY === 0) still++;
    stepWorld([e], world(), 1 / 60);
  }
  ok('it stops sometimes', still > frames * 0.15 && still < frames * 0.8,
     `${Math.round(100 * still / frames)}% of frames idle`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
