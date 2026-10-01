import {
  stepWorld, driveEnemy, rectHitsCircle, exitDirection, sweptLength,
  swingAngle, snapAim, SNAP, slotShape, slotCount,
  type RtUnit, type StepWorld, type AttackShape, type RtEvent,
} from '../realtime.js';

// The engine, with no server, no database and no clock: stepWorld is pure, so a
// battle is just frames handed to it. These started life as src/tools/
// test_realtime.ts, a standalone script — which meant the newest and most
// load-bearing code in the repo was the one part `npm test` did not cover.
//
// Time is explicit everywhere. Nothing here sleeps or reads Date.now, so a
// "second" is sixty frames of 1/60 and the numbers below are exact rather than
// timing-dependent.

const THRUST: AttackShape = { reach: 1, width: 0.45, activeMs: 120, coolMs: 500, tellMs: 0, damage: 16 };
const CLAWS: AttackShape = { reach: 1, width: 0.5, activeMs: 140, coolMs: 1100, tellMs: 360, damage: 9 };

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

const world = (blocked: string[] = [], size = 24): StepWorld =>
  ({ blocked: new Set(blocked), size });

/** Run n frames of dt, collecting everything that happened. */
function run(units: RtUnit[], w: StepWorld, frames: number, dt = 1 / 60): RtEvent[] {
  const all: RtEvent[] = [];
  for (let i = 0; i < frames; i++) all.push(...stepWorld(units, w, dt));
  return all;
}

const SECOND = 60;
const gap = (a: RtUnit, b: RtUnit) => Math.hypot(a.x - b.x, a.y - b.y);

describe('hitbox geometry', () => {
  const target = { x: 6, y: 5, r: 0.34 };

  test('reaches straight ahead', () => {
    expect(rectHitsCircle(5, 5, 0, 1, 0.45, target)).toBe(true);
  });

  test('misses behind', () => {
    expect(rectHitsCircle(5, 5, Math.PI, 1, 0.45, target)).toBe(false);
  });

  test('misses past its reach', () => {
    expect(rectHitsCircle(5, 5, 0, 0.5, 0.45, target)).toBe(false);
  });

  test('misses off to the side', () => {
    expect(rectHitsCircle(5, 5, 0, 1, 0.45, { x: 6, y: 6, r: 0.34 })).toBe(false);
  });

  test('a thrust is narrow', () => {
    // Shape is what distinguishes one weapon from another, so the width has to
    // actually decide the outcome: same reach, same target, opposite answers.
    expect(rectHitsCircle(5, 5, 0, 1, 0.2, { x: 5.8, y: 5.45, r: 0.2 })).toBe(false);
  });

  test('a swing is wide', () => {
    expect(rectHitsCircle(5, 5, 0, 1, 1.2, { x: 5.8, y: 5.45, r: 0.2 })).toBe(true);
  });

  test('works on the diagonal', () => {
    expect(rectHitsCircle(5, 5, Math.PI / 4, 1, 0.45, { x: 5.6, y: 5.6, r: 0.34 })).toBe(true);
  });
});

describe('reach is measured from the body edge', () => {
  // The renderer draws to this: a weapon's grip sits at `r` and its tip at
  // sweptLength, so these numbers are what make the drawing honest rather than
  // decorative. Changing the measure without changing map.js silently puts the
  // sword back out of step with what it hits.
  test('the swept rectangle is the radius plus the reach', () => {
    expect(sweptLength(0.34, 1)).toBeCloseTo(1.34, 5);
    expect(sweptLength(0, 1)).toBe(1);
  });

  test('a fatter body reaches further, rather than eating its own reach', () => {
    expect(sweptLength(0.6, 1)).toBeGreaterThan(sweptLength(0.34, 1));
  });

  test('the drawn tip is the real boundary', () => {
    // Head on, so the target's nearest surface is (distance - its radius) away.
    // With r 0.34 and reach 1 the sweep ends at 1.34, so a 0.34 target is
    // caught out to 1.68 between centres and not beyond it.
    const swept = sweptLength(0.34, 1);
    const hitAt = (d: number) =>
      rectHitsCircle(5, 5, 0, swept, 0.45, { x: 5 + d, y: 5, r: 0.34 });
    expect(hitAt(1.60)).toBe(true);
    expect(hitAt(1.67)).toBe(true);
    expect(hitAt(1.70)).toBe(false);
    expect(hitAt(2.00)).toBe(false);
  });

  test('a swing lands on something the old centre-measured reach would have missed', () => {
    // The gap this closed: just past reach-from-centre, comfortably inside
    // reach-from-edge. Nothing should be standing in a dead band that the
    // sword visibly covers.
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 6.5, y: 5 });
    p.aim = 0; p.wantAttack = true;
    run([p, e], world(), 4);
    expect(e.hp).toBeLessThan(100);
  });
});

describe('movement', () => {
  test('walks its speed in a second, after the acceleration ramp', () => {
    const u = unit({ id: 'p', team: 'player' });
    u.moveX = 1;
    run([u], world(), SECOND);
    // Short of a full second's travel by the ramp, which is the point: 0.22s
    // spent getting up to speed costs about half of it.
    expect(u.x).toBeGreaterThan(5 + 4.2 - 0.6);
    expect(u.x).toBeLessThan(5 + 4.2);
  });

  test('and full speed once up to it', () => {
    const u = unit({ id: 'p', team: 'player' });
    u.moveX = 1;
    run([u], world(), SECOND);
    const afterFirst = u.x;
    run([u], world(), SECOND);
    expect(u.x - afterFirst).toBeCloseTo(4.2, 1);
  });

  test('a diagonal is not faster than a straight line', () => {
    // The bug the grid had, and the reason the cost is the vector's length: two
    // keys held must not buy 1.41x the distance.
    const a = unit({ id: 'a', team: 'player' });
    const b = unit({ id: 'b', team: 'player', x: 15 });
    a.moveX = 1; a.moveY = 0;
    b.moveX = 1; b.moveY = 1;
    run([a], world(), SECOND);
    run([b], world(), SECOND);
    expect(Math.hypot(b.x - 15, b.y - 5)).toBeCloseTo(a.x - 5, 1);
  });

  test('stops against a solid tile, outside it', () => {
    const u = unit({ id: 'p', team: 'player', x: 5.5, y: 5.5 });
    u.moveX = 1;
    run([u], world(['6,5']), SECOND);
    expect(u.x).toBeLessThan(6);
    expect(u.x).toBeLessThanOrEqual(6 - u.r + 1e-6);   // the body, not its centre
  });

  test('cannot leave the chunk', () => {
    const u = unit({ id: 'p', team: 'player', x: 1, y: 5 });
    u.moveX = -1;
    run([u], world(), SECOND);
    expect(u.x).toBeGreaterThanOrEqual(u.r - 1e-6);
  });

  test('bodies push apart rather than occupying one spot', () => {
    const a = unit({ id: 'a', team: 'player', x: 5, y: 5 });
    const b = unit({ id: 'b', team: 'enemy', x: 5.1, y: 5 });
    run([a, b], world(), 1);
    expect(gap(a, b)).toBeGreaterThan(0.6);
  });
});

describe('attacks', () => {
  test('a player attack lands at once and is reported', () => {
    // No wind-up on the player's own swing: the press and the hit are the same
    // moment, or the controls feel late.
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 6, y: 5 });
    p.aim = 0; p.wantAttack = true;
    const events = run([p, e], world(), 2);
    expect(e.hp).toBe(100 - THRUST.damage);
    expect(events.some(v => v.kind === 'swing')).toBe(true);
    expect(events.some(v => v.kind === 'hit')).toBe(true);
  });

  test('one swing lands once, not once per frame', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 6, y: 5 });
    p.aim = 0; p.wantAttack = true;
    run([p, e], world(), 12);                  // the whole active window
    expect(e.hp).toBe(100 - THRUST.damage);
  });

  test('a cooldown refuses the second swing, then allows it', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 6, y: 5 });
    p.aim = 0;
    p.wantAttack = true; run([p, e], world(), 12);
    p.wantAttack = true; run([p, e], world(), 2);
    expect(e.hp).toBe(100 - THRUST.damage);
    p.wantAttack = true; run([p, e], world(), 40);    // wait it out
    expect(e.hp).toBe(100 - THRUST.damage * 2);
  });

  test('a wide swing catches two', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const a = unit({ id: 'a', team: 'enemy', x: 5.9, y: 4.75 });
    const b = unit({ id: 'b', team: 'enemy', x: 5.9, y: 5.25 });
    p.aim = 0; p.wantAttack = true;
    run([p, a, b], world(), 4);
    expect(a.hp).toBeLessThan(100);
    expect(b.hp).toBeLessThan(100);
  });

  test('a killing blow reports a death and takes the body out', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 6, y: 5, hp: THRUST.damage });
    p.aim = 0; p.wantAttack = true;
    const events = run([p, e], world(), 4);
    expect(events.some(v => v.kind === 'died' && v.id === 'e')).toBe(true);
    expect(e.dead).toBe(true);
  });

  test('an early press is held, not thrown away', () => {
    // docs/combat.md 0b. Dropping a press that arrives a few ms early is the
    // difference between a responsive weapon and one that ignores you.
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, cool: 200 });
    const e = unit({ id: 'e', team: 'enemy', x: 6, y: 5 });
    p.aim = 0; p.wantAttack = true;
    run([p, e], world(), 3);
    expect(p.wantAttack).toBe(true);           // still pending
    expect(e.hp).toBe(100);
    run([p, e], world(), 20);
    expect(e.hp).toBeLessThan(100);            // spends when the cooldown ends
  });
});

describe('a swing commits to its aim', () => {
  // The window is five ticks long so the animation has frames to play. That
  // made the old behaviour — re-reading `aim` on every active tick — into a
  // spin attack: a target is struck once per swing, so sweeping the mouse
  // through a circle caught everything standing around you off one press.
  const SPIN: AttackShape = {
    reach: 1, width: 0.45, activeMs: 250, coolMs: 500, tellMs: 0, damage: 16,
  };

  test('turning mid-swing does not drag the hitbox round', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, attack: SPIN });
    const front = unit({ id: 'front', team: 'enemy', x: 6, y: 5 });
    const behind = unit({ id: 'behind', team: 'enemy', x: 4, y: 5 });
    p.aim = 0; p.wantAttack = true;
    run([p, front, behind], world(), 2);
    p.aim = Math.PI;                           // spin to face the other one
    run([p, front, behind], world(), 4);
    expect(front.hp).toBeLessThan(100);        // caught where it was pointed
    expect(behind.hp).toBe(100);               // and not where it swung to
  });

  test('the committed aim is published, so the drawing can match it', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, attack: SPIN });
    expect(p.swingAim).toBeUndefined();
    p.aim = 1.25; p.wantAttack = true;
    run([p], world(), 1);
    expect(p.swingAim).toBeCloseTo(1.25, 5);
    p.aim = 3;                                 // the facing moves on
    run([p], world(), 1);
    expect(p.swingAim).toBeCloseTo(1.25, 5);   // the swing does not
  });

  test('it is released when the swing ends', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, attack: SPIN });
    p.aim = 1; p.wantAttack = true;
    run([p], world(), 20);                     // 20 frames of 1/60 clears 250ms
    expect(p.phase).toBe('idle');
    expect(p.swingAim).toBeUndefined();
  });

  test('a wind-up can still be turned, since it commits on release', () => {
    // The telegraph is there to be read, so the last moment it can change has
    // to be the moment it goes live, not the moment it starts.
    const e = unit({ id: 'e', team: 'enemy', x: 5, y: 5 });
    e.aim = 0; e.wantAttack = true;
    run([e], world(), 1);
    expect(e.phase).toBe('tell');
    e.aim = Math.PI;                           // turn during the wind-up
    // Step only until it goes live. Running blindly past that clears it again,
    // since the claws are active for 140ms and then done.
    for (let i = 0; i < 60 && e.phase !== 'active'; i++) run([e], world(), 1);
    expect(e.phase).toBe('active');
    expect(e.swingAim).toBeCloseTo(Math.PI, 5);
  });

  test('the window is five ticks, so five frames each get one', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, attack: SPIN });
    p.wantAttack = true;
    let swinging = 0;
    for (let i = 0; i < 10; i++) {
      run([p], world(), 1, 0.05);              // the server's 50ms tick
      if (p.phase === 'active') swinging++;
    }
    expect(swinging).toBe(4);                   // the fifth sets idle as it goes
    expect(SPIN.activeMs / 50).toBe(5);         // but is still struck on
  });
});

describe('an arc sweeps', () => {
  const ARC: AttackShape = {
    reach: 1, width: 0.45, activeMs: 250, coolMs: 250, tellMs: 0,
    damage: 12, spread: Math.PI / 2,
  };
  // Three bodies at the arc's start, middle and end, a tile out from the
  // swinger. Aimed east, the quarter turn runs north-east to south-east.
  const ring = (at: number[]) => at.map((a, i) => unit({
    id: `e${i}`, team: 'enemy',
    x: 5 + Math.cos(a), y: 5 + Math.sin(a),
  }));

  test('it catches everything along the way, once each', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, attack: ARC });
    const foes = ring([-SNAP, 0, SNAP]);
    p.aim = 0; p.wantAttack = true;
    run([p, ...foes], world(), 20);
    for (const f of foes) expect(f.hp).toBe(100 - ARC.damage);
  });

  test('a thrust in the same spot catches only what it points at', () => {
    // The difference the arc buys, stated as a comparison rather than assumed.
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const foes = ring([-SNAP, 0, SNAP]);
    p.aim = 0; p.wantAttack = true;
    run([p, ...foes], world(), 20);
    expect(foes[1].hp).toBeLessThan(100);
    expect(foes[0].hp).toBe(100);
    expect(foes[2].hp).toBe(100);
  });

  test('the hitbox is where the blade IS, not the whole fan at once', () => {
    // What keeps the drawing honest: the body at the END of the arc is struck
    // late in the swing, after the one at the start.
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, attack: ARC });
    const first = unit({ id: 'first', team: 'enemy', x: 5 + Math.cos(-SNAP), y: 5 + Math.sin(-SNAP) });
    const last = unit({ id: 'last', team: 'enemy', x: 5 + Math.cos(SNAP), y: 5 + Math.sin(SNAP) });
    p.aim = 0; p.wantAttack = true;

    let firstAt = 0, lastAt = 0, tick = 0;
    for (let i = 0; i < 10; i++) {
      tick++;
      const events = run([p, first, last], world(), 1, 0.05);
      for (const ev of events) {
        if (ev.kind !== 'hit') continue;
        if (ev.on === 'first' && !firstAt) firstAt = tick;
        if (ev.on === 'last' && !lastAt) lastAt = tick;
      }
    }
    expect(firstAt).toBeGreaterThan(0);
    expect(lastAt).toBeGreaterThan(firstAt);
  });

  test('it snaps to a compass point, so the arc has fixed ends', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5, attack: ARC });
    p.aim = 0.2;                                  // off east by a bit
    p.wantAttack = true;
    run([p], world(), 1);
    expect(p.swingAim).toBeCloseTo(0, 6);         // pulled onto east
    expect(p.swingAim).toBeCloseTo(snapAim(0.2), 6);
  });

  test('a thrust is not snapped, because it is aimed', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    p.aim = 0.2; p.wantAttack = true;
    run([p], world(), 1);
    expect(p.swingAim).toBeCloseTo(0.2, 6);
  });
});

describe('attack slots', () => {
  const ARC: AttackShape = {
    reach: 1, width: 0.45, activeMs: 250, coolMs: 250, tellMs: 0,
    damage: 12, spread: Math.PI / 2,
  };
  const SPIN: AttackShape = { ...ARC, spread: Math.PI * 2, damage: 9 };
  /** Slot 0 is the thrust it is built with; 1 is the arc, 2 the spin. */
  const armed = () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    p.extras = [ARC, SPIN];
    return p;
  };

  test('slot 0 is the primary, which is the field every unit has', () => {
    const p = armed();
    expect(slotShape(p, 0)).toBe(p.attack);
    expect(slotCount(p)).toBe(3);
  });

  test('a slot throws its own shape, not the primary', () => {
    const p = armed();
    const side = unit({ id: 'side', team: 'enemy', x: 5 + Math.cos(SNAP), y: 5 + Math.sin(SNAP) });
    p.aim = 0; p.wantSlot = 1;
    run([p, side], world(), 20);
    // Caught off to the side, which only the arc reaches, for the arc's damage.
    expect(side.hp).toBe(100 - ARC.damage);
  });

  test('slot 2 is the one bound to Q', () => {
    const p = armed();
    const behind = unit({ id: 'behind', team: 'enemy', x: 4, y: 5 });
    p.aim = 0; p.wantSlot = 2;
    run([p, behind], world(), 20);
    // Only a full turn comes round far enough to reach something behind you.
    expect(behind.hp).toBe(100 - SPIN.damage);
  });

  test('a swing in flight keeps its own shape', () => {
    // Pressing another button mid-swing must not change what is in the air.
    const p = armed();
    p.aim = 0; p.wantSlot = 1;
    run([p], world(), 1);
    expect(p.using).toBe(ARC);
    p.wantSlot = 0;
    run([p], world(), 2);
    expect(p.using).toBe(ARC);
  });

  test('and releases the shape when it ends', () => {
    const p = armed();
    p.wantSlot = 1;
    run([p], world(), 20);
    expect(p.phase).toBe('idle');
    expect(p.using).toBeUndefined();
  });

  test('the cooldown is the one belonging to the swing that was thrown', () => {
    const p = armed();
    p.wantSlot = 1;
    run([p], world(), 20);
    expect(p.cool).toBeGreaterThan(0);
    expect(p.cool).toBeLessThanOrEqual(ARC.coolMs);
  });

  test('a slot the unit does not have is ignored', () => {
    const p = armed();
    p.wantSlot = 7;
    run([p], world(), 2);
    expect(p.phase).toBe('idle');
    expect(slotShape(p, 7)).toBeNull();
  });

  test('a unit with no extras still throws its primary', () => {
    // driveEnemy sets the bare flag rather than a slot, so that path has to
    // keep working for everything without slots.
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const foe = unit({ id: 'foe', team: 'enemy', x: 6, y: 5 });
    p.aim = 0; p.wantAttack = true;
    run([p, foe], world(), 4);
    expect(foe.hp).toBeLessThan(100);
    expect(slotCount(p)).toBe(1);
  });

  test('swingAngle is the one rule both the hitbox and the drawing use', () => {
    expect(swingAngle(ARC, 0, 0)).toBeCloseTo(-Math.PI / 4, 6);
    expect(swingAngle(ARC, 0, 1)).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe('enemies', () => {
  test('closes the distance, telegraphs, and gets damage in', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 12, y: 5, speed: 2.6 });
    let told = false;
    for (let i = 0; i < 400; i++) {
      driveEnemy(e, [p], 1000 / 60);
      for (const v of stepWorld([p, e], world(), 1 / 60)) if (v.kind === 'tell') told = true;
    }
    expect(gap(e, p)).toBeLessThan(1.5);
    expect(told).toBe(true);
    expect(p.hp).toBeLessThan(100);
  });

  test('a wind-up can be walked out of', () => {
    // A telegraph is only worth having if leaving actually saves you, which is
    // the whole skill the real-time move is meant to buy.
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 6, y: 5, speed: 0 });
    driveEnemy(e, [p], 1000 / 60);
    stepWorld([p, e], world(), 1 / 60);
    expect(e.phase).toBe('tell');
    p.moveX = 1; p.moveY = -1;                 // leave while it winds up
    run([p, e], world(), 40);
    expect(p.hp).toBe(100);
  });

  test('faces the pair standing on the same spot', () => {
    // Nearest first, lowest HP to break a tie.
    const a = unit({ id: 'a', team: 'player', x: 6, y: 5, hp: 90 });
    const b = unit({ id: 'b', team: 'player', x: 6, y: 5, hp: 20 });
    const e = unit({ id: 'e', team: 'enemy', x: 5, y: 5 });
    driveEnemy(e, [a, b], 1000 / 60);
    expect(Math.abs(e.aim)).toBeLessThan(0.2);
  });
});

describe('throttle', () => {
  test('a short intent vector moves slower', () => {
    // Magnitude is a throttle, not a direction, so a wandering body can potter
    // instead of only ever sprinting.
    const full = unit({ id: 'f', team: 'player' });
    const half = unit({ id: 'h', team: 'player', x: 15 });
    full.moveX = 1;
    half.moveX = 0.4;
    run([full], world(), SECOND);
    run([half], world(), SECOND);
    const ratio = (half.x - 15) / (full.x - 5);
    // Not exactly 0.4 over the first second: the slower one finishes its ramp
    // sooner, so it loses proportionally less to the acceleration.
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.5);
  });
});

describe('vision', () => {
  test('does not notice you from far off', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 18, y: 5, vision: 8, speed: 0 });
    driveEnemy(e, [p], 16);
    expect(e.wantAttack).toBe(false);
    expect(e.phase).toBe('idle');
  });

  test('notices you once you are inside its range', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 18, y: 5, vision: 8, speed: 0 });
    driveEnemy(e, [p], 16);
    p.x = 10;                                  // walk into its range
    // Turning is rate-limited, so it comes round over a few frames rather than
    // snapping to face you.
    for (let i = 0; i < 30; i++) driveEnemy(e, [p], 1000 / 60);
    expect(Math.abs(e.aim)).toBeCloseTo(Math.PI, 1);
  });

  test('out of sight means it never reaches you, and you take nothing', () => {
    const p = unit({ id: 'p', team: 'player', x: 5, y: 5 });
    const e = unit({ id: 'e', team: 'enemy', x: 20, y: 20, vision: 6, speed: 2.6 });
    for (let i = 0; i < 300; i++) {
      driveEnemy(e, [p], 1000 / 60);
      stepWorld([p, e], world(), 1 / 60);
    }
    expect(gap(e, p)).toBeGreaterThan(3);
    expect(p.hp).toBe(100);
  });
});

describe('wandering', () => {
  test('an idle body drifts, but does not bolt', () => {
    const e = unit({ id: 'e', team: 'enemy', x: 12, y: 12, vision: 6, speed: 2.6 });
    const start = { x: e.x, y: e.y };
    let moved = false;
    for (let i = 0; i < 600; i++) {
      driveEnemy(e, [], 1000 / 60);
      stepWorld([e], world(), 1 / 60);
      if (Math.hypot(e.x - start.x, e.y - start.y) > 0.5) moved = true;
    }
    expect(moved).toBe(true);
    expect(Math.hypot(e.x - start.x, e.y - start.y)).toBeLessThan(14);
  });

  test('and never attacks thin air', () => {
    const e = unit({ id: 'e', team: 'enemy', x: 12, y: 12, vision: 6 });
    let swung = false;
    for (let i = 0; i < 400; i++) {
      driveEnemy(e, [], 1000 / 60);
      for (const v of stepWorld([e], world(), 1 / 60)) if (v.kind === 'swing') swung = true;
    }
    expect(swung).toBe(false);
  });

  test('it stops sometimes', () => {
    // Pauses are half the point: a body that never stops reads as patrolling
    // rather than idling.
    const e = unit({ id: 'e', team: 'enemy', x: 12, y: 12, vision: 6 });
    let still = 0, frames = 0;
    for (let i = 0; i < 1800; i++) {
      driveEnemy(e, [], 1000 / 60);
      frames++;
      if (e.moveX === 0 && e.moveY === 0) still++;
      stepWorld([e], world(), 1 / 60);
    }
    expect(still / frames).toBeGreaterThan(0.15);
    expect(still / frames).toBeLessThan(0.8);
  });
});

describe('exitDirection', () => {
  // Which edge a body walked off, which is how a chunk hands you to the next
  // one. Extracted from the sim tick so it can be asked without a socket.
  const size = 24;
  const at = (x: number, y: number, moveX = 0, moveY = 0) =>
    exitDirection(unit({ id: 'p', team: 'player', x, y, moveX, moveY }), size);

  test('the middle is not an exit, however hard you walk', () => {
    expect(at(12, 12, -1, -1)).toEqual({ dx: 0, dy: 0 });
  });

  test('standing on the edge is not an exit — you have to be pressing into it', () => {
    // Both halves are required, and this is the half that matters: bodies get
    // shoved around by collisions, and being pushed against a border must not
    // post you into the next chunk.
    expect(at(0, 12)).toEqual({ dx: 0, dy: 0 });
    expect(at(0, 12, 1, 0)).toEqual({ dx: 0, dy: 0 });    // pressing back inward
    expect(at(0, 12, -1, 0)).toEqual({ dx: -1, dy: 0 });  // pressing outward
  });

  test('each edge gives its own direction', () => {
    expect(at(0, 12, -1, 0)).toEqual({ dx: -1, dy: 0 });
    expect(at(size, 12, 1, 0)).toEqual({ dx: 1, dy: 0 });
    expect(at(12, 0, 0, -1)).toEqual({ dx: 0, dy: -1 });
    expect(at(12, size, 0, 1)).toEqual({ dx: 0, dy: 1 });
  });

  test('the edge is the body, not its centre', () => {
    // A unit is stopped by the wall at its own radius, so it can never get its
    // centre to 0 — the threshold has to allow for that or an edge is
    // unreachable and a chunk has no way out.
    const u = unit({ id: 'p', team: 'player', x: 1, y: 12, moveX: -1 });
    run([u], world(), SECOND);
    expect(u.x).toBeGreaterThan(0);
    expect(exitDirection(u, size)).toEqual({ dx: -1, dy: 0 });
  });

  test('a corner gives both axes at once', () => {
    // Not one axis, which is what a grid would have forced: the walk is
    // continuous, so a diagonal into a corner crosses diagonally. That lands
    // somewhere real because the chunk grid is a Chebyshev square and the
    // corner chunk exists (see places.test.ts). Note this is the one crossing
    // exitsFrom does not list, since that names doorways, not momentum.
    expect(at(0, 0, -1, -1)).toEqual({ dx: -1, dy: -1 });
  });
});
