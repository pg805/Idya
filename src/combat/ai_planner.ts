// Utility-scoring AI. Replaces the fixed pattern walk with a per-turn decision:
// enumerate (destination, action, target) plans, score each with a deterministic
// heuristic, pick the best. Behaviour (kite / smash / heal / control) emerges from
// the weapon's kit + the unit's HP, so there are no per-enemy scripts.
//
// The core idea: every attack has an "affected set" of tiles, and its hit chance
// is the predicted-player probability that lands inside it. Single-target covers
// one tile (easy to dodge), AOE covers a block (hard), reactive covers the range
// disk around where the unit ends up (dodge = leave range). See predictPlayerTiles.
import { CombatSession, Combatant, CombatantMeta } from './combat_session.js';
import { CombatIntent, ActionChoice } from './intent.js';
import { Pos, chebyshevDist, rangeDist, cellsOf, occupies } from './board.js';
import { hasLineOfSight } from './los.js';
import { reachableDanger, ReachDanger } from './movement.js';
import { effectiveMove } from './combatant_state.js';
import { isHostile } from './disposition.js';
import { areaBlock, selfBurstCells } from './resolution.js';
import Action, { ActionType, SELF_TARGET_TYPES } from '../weapon/action.js';

const key = (p: Pos) => `${p.x},${p.y}`;

// Tunable weights — the difficulty / personality dial.
const W = {
  heal: 0.8,
  defend: 1.0,
  control: 1.2,
  approach: 3.0,   // pull toward getting inside my own attack range (beats idle/restore when far)
  safety: 2.0,     // distance from the foe = safety, scaled by how fragile I am
  hazardPath: 1.0,
  restore: 0.5,
  buff: 0.3,
  kill: 40,        // flat bonus for a likely kill
  allyTile: 1.0,   // dropping a block/buff tile to stand on
  corner: 0.6,     // (smart chaser only) herd a fleeing foe toward a wall
  critSeek: 3.0,   // (smart only) chase my counter-crit when I read the foe's category
  critFear: 3.0,   // (smart only) shy off a category the foe's counter-crit punishes
  repeat: 5.0,     // slight nudge AWAY from repeating last turn's category (variety)
  clear: 0.4,      // bonus for overwriting a foe's tile with mine (tile wars — kept
                   // modest so a unit doesn't fixate on clearing instead of attacking)
  betBlock: 10,    // penalty × P(foe stays) for ending on a square the foe holds — the
                   // move contest blocks me if it doesn't vacate (stationary ▶ player ▶ NPC)
};
// Worth of wiping a foe's tile by dropping mine on top (overwrite). Hazards/buffs
// by their value; slow by a flat delay estimate.
const clearValue = (t: { kind: string; value: number }) => (t.kind === 'slow' ? 6 : t.value);
const FOE_ATTACK_CHANCE = 0.5;  // rough odds the foe Attacks this turn (→ its crit lands if I Special)
// Rough "what one player hit costs me", used for the vulnerability dial. A real
// damage read isn't available (we only see the foe's range/cost, not its field),
// so this is a constant for now — tune, or later estimate from observed hits.
const ESTIMATED_INCOMING = 25;
const ROLL_MULT: Record<string, number> = { Hd4: 1.3, Hd2: 1.15, '1d': 1.0, Ld2: 0.7 };

const ev = (f: number[]) => (f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0);
const fieldOf = (a: Action) => (((a as unknown as { field?: { field: number[] } }).field?.field) ?? []);
const valueOf = (a: Action) => (a as unknown as { value?: number }).value ?? 0;
const roundsOf = (a: Action) => (a as unknown as { rounds?: number }).rounds ?? 1;
const isDamaging = (a: Action) => a.type === ActionType.Strike || a.type === ActionType.DamageOverTime;

// Category triangle: which category each beats / is beaten by, and the crit slot
// each plays. MOOD_P turns the telegraph mood into rough odds on the foe's
// category. critValue is a crit's magnitude (damage EV, or value×rounds for a
// buff/heal/reflect) — what it's worth to land or to eat.
const TRI_BEATS: Record<string, string> = { attack: 'special', special: 'defend', defend: 'attack' };
const TRI_BEATEN: Record<string, string> = { attack: 'defend', special: 'attack', defend: 'special' };
const TRI_CRIT: Record<string, string> = { attack: 'attack_crit', special: 'special_crit', defend: 'defend_crit' };
// Mood → rough category odds. Validated: "hostile" is mostly a basic ATTACK
// (specials run 2–35%), so a hostile read should point me at Defend, not make me
// fear a Special that probably isn't coming.
const MOOD_P: Record<string, Record<string, number>> = {
  defensive: { attack: 0.15, special: 0.15, defend: 0.7 },
  hostile:   { attack: 0.6, special: 0.2, defend: 0.2 },
};
const critValue = (a: Action): number => { const f = fieldOf(a); return (f.length ? ev(f) : valueOf(a)) * roundsOf(a); };

function maxDamagingRange(c: Combatant): number {
  let r = 1;
  for (const a of c.weaponInfo.actions) if (a.choice === 'attack' || a.choice === 'special') r = Math.max(r, a.range);
  return r;
}

// Probability distribution over where `foe` will likely stand after the move
// phase. Weighted toward tiles it can attack `me` from (players move to fight),
// with a falloff for advance tiles further from range. Normalized to sum 1.
export function predictPlayerTiles(me: Combatant, foe: Combatant, session: CombatSession): Map<string, number> {
  const fState = session.meta.get(foe.id)?.state;
  const moveRange = fState ? effectiveMove(foe.movementRange, fState) : foe.movementRange;
  const occupied = new Set(session.combatants.filter(c => c.id !== foe.id).flatMap(c => cellsOf(c).map(key)));
  const reach = reachableDanger(foe.pos, moveRange, session.board, occupied, foe.teamId, foe.size);
  const foeRange = maxDamagingRange(foe);

  const raw = new Map<string, number>();
  let total = 0;
  const consider = (t: Pos) => {
    const d = chebyshevDist(t, me.pos);
    let w = (d <= foeRange && hasLineOfSight(t, me.pos, session.board))
      ? 3                                            // can hit me from here — prime spot
      : Math.max(0.2, 1.5 - 0.3 * (d - foeRange));   // gradient: closer to range = likelier
    const tile = session.board.getTile(t);
    // Foes route AROUND my tiles — a hazard is dodged almost entirely (so I can't
    // count on it landing), a slow tile is shied off. This stops a tile-kiter from
    // fleeing forever on the fantasy that its pit is "productive" when it's dodged.
    if (tile && tile.teamId === me.teamId) {
      if (tile.kind === 'hazard') w *= 0.12;
      else if (tile.kind === 'slow') w *= 0.6;
    }
    raw.set(key(t), (raw.get(key(t)) ?? 0) + w);
    total += w;
  };
  consider(foe.pos);                                 // staying put is always an option
  for (const r of reach.values()) consider(r.pos);

  if (total > 0) for (const [k, w] of raw) raw.set(k, w / total);
  return raw;
}

// The tiles an action touches when launched from `dest` at `target`.
function affectedKeys(action: Action, dest: Pos, target: Pos | null, session: CombatSession, size = 1): Set<string> {
  if (action.aimed && !target) return new Set();            // aimed but nothing in range → hits nothing
  if (action.aimed && action.area > 1 && target)            // aimed AOE: the block at the target
    return new Set(areaBlock(target, action.area, dest).filter(p => session.board.inBounds(p)).map(key));
  if (action.aimed && target)                               // aimed single: just the target tile
    return new Set([key(target)]);
  if (!action.aimed && action.area > 1)                     // reactive self-burst: block around me
    return new Set(selfBurstCells(dest, size, action.area, dest).filter(p => session.board.inBounds(p)).map(key));
  const disk = new Set<string>();                           // reactive single: the in-range disk
  for (let dx = -action.range; dx <= action.range; dx++)
    for (let dy = -action.range; dy <= action.range; dy++) {
      const p = { x: dest.x + dx, y: dest.y + dy };
      if (session.board.inBounds(p)) disk.add(key(p));
    }
  return disk;
}

// How much predicted player-mass an attack covers = its chance to connect.
function hitProb(action: Action, dest: Pos, target: Pos | null, predicted: Map<string, number>, session: CombatSession, size = 1): number {
  let p = 0;
  for (const k of affectedKeys(action, dest, target, session, size)) p += predicted.get(k) ?? 0;
  return Math.min(1, p);
}

// Candidate target tiles for an aimed action from `dest`: the foe's likely
// squares in range + LOS. (Reactive / self-target take no target.)
function candidateTargets(action: Action, dest: Pos, predicted: Map<string, number>, session: CombatSession): (Pos | null)[] {
  if (!action.aimed) return [null];
  // Ally tiles (buff/block) benefit MY team, so aim them at my own square — not
  // the foe's. The owner stands on them; dropping one on the enemy is wasted.
  if (action.type === ActionType.BuffTile || action.type === ActionType.BlockTile) return [{ ...dest }];
  const out: Pos[] = [];
  for (const k of predicted.keys()) {
    const [x, y] = k.split(',').map(Number);
    const p = { x, y };
    // Use rangeDist (the alternating-diagonal metric resolution gates on), NOT
    // chebyshev — otherwise the planner aims at a diagonal tile it reads as in
    // range that resolution then fizzles as "out of range" (the deer bug).
    const d = rangeDist(dest, p);
    if (d < 1 || d > action.range) continue;
    if (action.range > 1 && !hasLineOfSight(dest, p, session.board)) continue;
    out.push(p);
  }
  return out.length ? out : [null];
}

function scorePlan(
  me: Combatant, meta: CombatantMeta, foe: Combatant, foeMeta: CombatantMeta | undefined,
  dest: Pos, destInfo: ReachDanger | undefined, action: Action, target: Pos | null,
  predicted: Map<string, number>, session: CombatSession,
  myMaxAtkCost: number, myCat: ActionChoice, smart = false, foeMood: 'hostile' | 'defensive' | null = null,
  raceDefense = 1,
): number {
  const vuln = ESTIMATED_INCOMING / Math.max(1, meta.state.health);
  const foeReach = foe.movementRange + maxDamagingRange(foe);
  const foeCanHitDest = chebyshevDist(dest, foe.pos) <= foeReach;
  // Tile I'd be standing on at `dest` — own buff/block tiles are worth moving onto.
  const destTile = session.board.getTile(dest);
  const onMyTile = (k: 'block' | 'buff') => !!destTile && destTile.teamId === me.teamId && destTile.kind === k;
  let score = 0;
  let av = 0;   // action VALUE (offense/defense/control/…) — multiplied by the bar-driven
                // category lean at the end. Positioning/risk go straight into `score`.
  // Does this plan actually hurt or control the foe from here? Kiting (the safety
  // term) is only worth it if fleeing is PRODUCTIVE — a unit that backs off doing
  // nothing is just stalling, so it shouldn't value the distance.
  let threatening = false;

  // Effect-maintenance: re-applying a DOT / debuff / move-debuff / buff that's still
  // ticking (2+ rounds left) is a wasted turn — overwrite doesn't stack. Devaluing it
  // makes a caster apply the effect, then poke/attack, and only refresh as it lapses
  // (the cast→poke→recast rhythm), instead of spamming it every turn.
  const stale = (e: { rounds: number }) => (e.rounds >= 2 ? 0.15 : 1);

  // --- offense: expected damage = EV × hit chance, with the resist roll-mode skew ---
  if (isDamaging(action)) {
    const mode = foeMeta?.state.get_roll_mode(action) ?? '1d';
    const evDmg = ev(fieldOf(action)) * roundsOf(action) * (ROLL_MULT[mode] ?? 1);
    const ph = hitProb(action, dest, target, predicted, session, me.size);
    if (ph > 0.15) threatening = true;
    const maint = action.type === ActionType.DamageOverTime ? stale(foeMeta?.state.dot ?? { rounds: 0 }) : 1;
    av += evDmg * ph * maint;
    if (onMyTile('buff')) av += destTile!.value * ph;   // attacking from my buff tile hits harder
    if (evDmg >= foe.hp) av += W.kill * ph;   // expected value of finishing — take the shot even at modest odds, don't turtle past a kill
    if (action.area > 1) {                                            // other foes caught now
      const cells = affectedKeys(action, dest, target, session, me.size);
      for (const e of session.combatants)
        if (e.teamId !== me.teamId && e.id !== foe.id && cells.has(key(e.pos))) av += evDmg;
    }
  }

  // --- sustain / defense, valued by whether surviving converts into the kill
  // (raceDefense), NOT by raw fragility — that was the death-spiral that made a low-
  // HP unit defend forever without ever progressing. ---
  if (action.type === ActionType.Heal) {
    const missing = me.maxHp - meta.state.health;
    // Weight by how hurt I am, not just whether the heal would land its full value —
    // a heal at near-full HP is low priority and ramps up smoothly as I drop, so the
    // AI presses while healthy instead of healing too early. No hard gate.
    const urgency = missing / Math.max(1, me.maxHp);
    av += Math.min(valueOf(action), missing) * W.heal * raceDefense * urgency;
  }
  // Defense is only worth it if the foe can actually hit me this turn — shielding
  // when safe is a wasted turn (the old "turtle forever" bug). Multi-round shields
  // are modestly better, not ×rounds.
  const isMyDefend = action.type === ActionType.Block || action.type === ActionType.Shield || action.type === ActionType.Reflect;
  if (isMyDefend) {
    const dur = 1 + 0.3 * (roundsOf(action) - 1);
    // Defending only helps against INCOMING damage. If I read the foe as defensive
    // (guarding, not swinging), my block is a wasted turn — this is what breaks the
    // defend-vs-defend mutual turtle. Smart side reads the telegraph mood; the base
    // AI falls back to "can it reach me".
    const incoming = !smart || foeMood === 'hostile';
    const threatened = (foeCanHitDest && incoming) ? 1 : 0.15;
    av += Math.min(valueOf(action), ESTIMATED_INCOMING) * dur * raceDefense * W.defend * threatened;
  }
  if (action.type === ActionType.Buff) av += valueOf(action) * W.buff * stale(meta.state.buff);

  // --- control tiles: reward placement on the foe's likely path. Skip re-dropping
  // the same zone where my tile already sits.
  if ((action.type === ActionType.HazardTile || action.type === ActionType.SlowTile) && action.aimed && target) {
    const kind = action.type === ActionType.HazardTile ? 'hazard' : 'slow';
    const here = session.board.getTile(target);
    const dup = here && here.teamId === me.teamId && here.kind === kind;
    if (dup) {
      av -= 1;  // my zone already covers this — don't re-drop the same tile
    } else {
      let mass = 0;
      for (const p of areaBlock(target, action.area, dest)) mass += predicted.get(key(p)) ?? 0;
      if (mass > 0.03) threatening = true;   // a hazard/slow on their path is progress
      const unit = action.type === ActionType.HazardTile ? valueOf(action) : 6;  // slow ≈ delay
      av += mass * unit * W.control;
      if (here && here.teamId !== me.teamId) av += clearValue(here) * W.clear;  // overwrite the foe's tile
    }
  }
  if (action.type === ActionType.MoveDebuff) {
    const ph = hitProb(action, dest, target, predicted, session);
    if (ph > 0.15) threatening = true;
    av += ph * roundsOf(action) * 4 * (W.control / 1.2) * stale(foeMeta?.state.moveDebuff ?? { rounds: 0 });
  }
  // Attack debuff: saps the foe's damage for `rounds` — value ≈ atk reduction ×
  // rounds × (the foe attacking), landed with hit chance.
  if (action.type === ActionType.Debuff) {
    const ph = hitProb(action, dest, target, predicted, session);
    if (ph > 0.15) threatening = true;
    av += ph * valueOf(action) * roundsOf(action) * FOE_ATTACK_CHANCE * W.defend * stale(foeMeta?.state.debuff ?? { rounds: 0 });
  }

  // --- ally tiles (block/buff zones to stand on): score so kits built around them
  // (Pickaxe, Spellbook's Bookmark) actually use them. Don't credit re-dropping a
  // tile that's already there.
  if (action.type === ActionType.BlockTile || action.type === ActionType.BuffTile) {
    const at = action.aimed && target ? target : dest;
    const here = session.board.getTile(at);
    // Redundant only if it's MY OWN same-kind tile — replacing a foe's tile (or a
    // different one of mine) is fine, and rewarded below.
    const dup = here && here.teamId === me.teamId &&
      here.kind === (action.type === ActionType.BlockTile ? 'block' : 'buff');
    if (dup) {
      av -= 1;  // already my tile here — don't waste a turn re-dropping it
    } else {
      av += action.type === ActionType.BlockTile
        ? valueOf(action) * raceDefense * W.defend * 1.2     // a persistent self-shield
        : valueOf(action) * W.allyTile * 0.6;          // boosts my future strikes
      if (here && here.teamId !== me.teamId) av += clearValue(here) * W.clear;  // overwrite the foe's tile
    }
  }

  // --- positioning: two opposing pulls ---
  //   approach — close the gap until I'm inside my OWN attack range, so I keep
  //     advancing even on turns I can't hit yet (fixes greedy "idle out of range").
  //   safety   — distance from the foe is worth more the more fragile I am, capped
  //     at the foe's threat reach. Tiny for a healthy tank; dominant for a hurt or
  //     squishy unit, which is what makes kiting / retreat-to-heal emerge.
  const myRange = maxDamagingRange(me);
  const foeThreat = foe.movementRange + maxDamagingRange(foe);
  const d = chebyshevDist(dest, foe.pos);
  score -= Math.max(0, d - myRange) * W.approach;
  // Safety is only worth chasing when fleeing is PRODUCTIVE — if this plan does
  // nothing to the foe, backing off is a pointless stall, so don't reward distance.
  // (This is what stops a fragile unit kiting forever with no payoff.)
  if (threatening) score += Math.min(d, foeThreat) * vuln * W.safety;

  // Betting on a square a foe currently holds (I can chase onto it since it moves
  // when I do) only pays off if it vacates — the move contest blocks me if it
  // stays put. Discount by the predicted chance it stays, so I follow a fleeing
  // foe but don't faceplant into a camper and waste the turn getting re-routed.
  const foeHolds = session.combatants.find(c => c.teamId !== me.teamId && occupies(c, dest));
  if (foeHolds) score -= (predicted.get(key(dest)) ?? 0) * W.betBlock;

  // Cornering (smart chaser only): when I still can't reach the foe, prefer the
  // approach ANGLE that leaves it less room to flee — i.e. back it toward a wall.
  // At equal move speed you can't catch a fleer in the open, but you CAN herd it
  // into an edge, which is how a human pins a kiter. Only bites while closing.
  if (smart && d > myRange) {
    const fdx = Math.sign(foe.pos.x - dest.x), fdy = Math.sign(foe.pos.y - dest.y);
    const far = Math.max(session.board.width, session.board.height);
    const roomX = fdx > 0 ? session.board.width - 1 - foe.pos.x : fdx < 0 ? foe.pos.x : far;
    const roomY = fdy > 0 ? session.board.height - 1 - foe.pos.y : fdy < 0 ? foe.pos.y : far;
    score -= Math.min(roomX, roomY) * W.corner;   // less flee room = better
  }

  // --- category triangle (smart only), VALUE-AWARE. The telegraph mood gives rough
  // odds on the foe's category; MY crit lands if I play what beats theirs, and THEIR
  // counter-crit lands if they play what beats mine — each weighed by the crit's real
  // EV. So I chase a fat special_crit into a likely guard and shy off a Special that
  // would eat a big attack_crit. Engagement-gated (foeCanHitDest) and read off the
  // telegraph, so it's not omniscient. (Self-target crits still score by their value,
  // since landing one is a benefit and eating the foe's is a loss.)
  if (smart && foeMood && foeCanHitDest) {
    const P = MOOD_P[foeMood];
    const myCrit = (meta.weapon as unknown as Record<string, Action[]>)[TRI_CRIT[myCat]];
    if (myCrit && myCrit.length > 0) score += critValue(myCrit[0]) * P[TRI_BEATS[myCat]] * W.critSeek;
    const foeCrit = foeMeta && (foeMeta.weapon as unknown as Record<string, Action[]>)[TRI_CRIT[TRI_BEATEN[myCat]]];
    if (foeCrit && foeCrit.length > 0) score -= critValue(foeCrit[0]) * P[TRI_BEATEN[myCat]] * W.critFear;
  }

  // --- penalties / economy ---
  score -= (destInfo?.hazard ?? 0) * W.hazardPath;
  // Variety: a slight push away from repeating last turn's category, so a unit
  // rotates categories instead of locking into one (e.g. heal-looping) when two
  // options score near-even. Small enough that a clearly-better play still wins.
  if (meta.state.last_category === myCat) score -= W.repeat;
  // Restoring resource only matters when being short is actually blocking my best
  // offensive move — otherwise it's a wasted turn (the other half of the turtle bug).
  if (action.cost < 0 && meta.state.resource_current < myMaxAtkCost)
    av += Math.min(meta.state.resource_max - meta.state.resource_current, -action.cost) * W.restore;

  // --- the 4 bars: the category lean a player can READ off the screen. My HP/resource
  // set turtle-vs-unleash; your HP/resource set finish-vs-brace. It MULTIPLIES the
  // action value (not positioning/risk), so it mostly decides the category — but a much
  // better action, or a stale effect (the ×0.15 above), still overrides it. Centered so
  // attack = 1.0 (the baseline), special/defend swing with the bars.
  const myHP = meta.state.health / Math.max(1, me.maxHp);
  const myRes = meta.state.resource_current / Math.max(1, meta.state.resource_max);
  const foeHP = (foeMeta?.state.health ?? foe.hp) / Math.max(1, foe.maxHp);
  const foeRes = foeMeta ? foeMeta.state.resource_current / Math.max(1, foeMeta.state.resource_max) : 0;
  // Only the AI enemies (smart=false) get the bar-lean — that's what makes THEM
  // readable. The smart side stands in for a human, who reads the enemy and picks
  // freely, so it keeps lean = 1.
  const lean = smart ? 1
             : myCat === 'special' ? 0.6 + 0.8 * myRes + 0.3 * (1 - foeHP)   // charged → unleash; your low HP → finish
             : myCat === 'defend'  ? 0.5 + 0.7 * (1 - myHP) + 0.5 * foeRes   // hurt → survive; your charge → brace
             : 1.0;                                                          // attack = the baseline
  score += av * lean;
  return score;
}

function collectAffordable(meta: CombatantMeta): { choice: ActionChoice; index: number; action: Action }[] {
  const out: { choice: ActionChoice; index: number; action: Action }[] = [];
  const add = (arr: Action[], choice: ActionChoice) => arr.forEach((action, index) => {
    if (action.cost > 0 && action.cost > meta.state.resource_current) return;
    out.push({ choice, index, action });
  });
  add(meta.weapon.defend, 'defend');
  add(meta.weapon.attack, 'attack');
  add(meta.weapon.special, 'special');
  return out;
}

const pass = (id: string): CombatIntent => ({ combatantId: id, moveTo: null, action: { type: 'pass', actionIndex: 0, targetPos: null } });

// One scored plan, recorded when a collector is passed to choosePlan — powers the
// dev replay (see the trace in spatial_sim).
export interface PlanCandidate {
  dest: Pos;
  choice: ActionChoice;
  index: number;
  action: string;
  target: Pos | null;
  score: number;
}

// Pick the best (destination, action, target) plan for `me` this turn.
// Deterministic: same board → same choice. Ties break toward less movement,
// then the lower action index. Pass `collect` to record every candidate's score.
// `smart` = play the stronger anti-kite logic (cornering). The sim turns this on
// for the player side so it stands in for a competent human; the shipped enemy AI
// runs with it off.
export function choosePlan(me: Combatant, session: CombatSession, collect?: PlanCandidate[], smart = false): CombatIntent {
  const meta = session.meta.get(me.id);
  if (!meta) return pass(me.id);
  const enemies = session.combatants.filter(c => c.teamId !== me.teamId);
  if (enemies.length === 0) return pass(me.id);

  const foe = enemies.reduce((a, b) => chebyshevDist(me.pos, a.pos) <= chebyshevDist(me.pos, b.pos) ? a : b);
  const foeMeta = session.meta.get(foe.id);
  const predicted = predictPlayerTiles(me, foe, session);

  // Progress framing: I only win by taking the foe to 0. Estimate the damage race
  // from kit potential (enemy stats are known, so this isn't omniscient): my
  // turns-to-kill vs turns-to-live. Defending/healing earns its keep ONLY when the
  // race is close (it tips the result). Winning comfortably → just attack; hopelessly
  // behind → defending only delays a loss, so commit to offense and at least RESOLVE
  // instead of mutual-turtling. Fed to scorePlan as the defensive multiplier.
  const dprOf = (m: CombatantMeta | undefined) => m
    ? 0.5 * Math.max(0, ...[...m.weapon.attack, ...m.weapon.special].filter(isDamaging).map(a => ev(fieldOf(a))))
    : 0;
  const turnsToKill = (foeMeta?.state.health ?? foe.hp) / Math.max(1, dprOf(meta));
  const turnsToLive = meta.state.health / Math.max(1, dprOf(foeMeta));
  const behind = turnsToKill - turnsToLive;
  // About to die AND the race is still winnable → a survival heal/block is worth it
  // (that's not turtling, it's staying in the fight). Hopelessly behind → no amount
  // of defending wins, so commit to offense and resolve.
  // Critical (about to die — within ~2-3 of the foe's hits) → survival first:
  // heal/block to stay in the fight, even if the raw race looks lost (it ignores my
  // own sustain — a tank's heal changes everything). Defined off turns-to-live so it
  // doesn't depend on maxHp. Otherwise: hopeless → commit to offense and resolve;
  // winning → just attack; close → defense tips it.
  const critical = turnsToLive <= 2.5;
  const raceDefense = critical ? 2.0 : behind > 2 ? 0.2 : behind <= -1 ? 0.4 : 1.2;

  // Opponent read (smart only) — only what a player can SEE, never the exact plan:
  // the telegraph mood (hostile = offensive / defensive = guarding) + movement
  // (closing/holding/fleeing), exactly what computeTelegraph shows. NOTE: we do NOT
  // try to split hostile into attack-vs-special from the resource bar — validation
  // showed "loaded → special" only holds for special-happy enemies (deer ~99%);
  // most still jab even when charged (special-rate 2–35%), so it's not a reliable
  // tell. Only "depleted → attack" is universal, and "hostile → block" covers that.
  // `holding` loosely says "it's lingering here" → bias aim toward where it stands.
  let foeMood: 'hostile' | 'defensive' | null = null;
  if (smart && foeMeta) {
    const fi = choosePlan(foe, session, undefined, false);
    const list = (foeMeta.weapon as unknown as Record<string, Action[]>)[fi.action.type];
    const fa = list?.[fi.action.actionIndex];
    if (fa) {
      foeMood = isHostile(fa) ? 'hostile' : 'defensive';
      const before = chebyshevDist(foe.pos, me.pos);
      const after = fi.moveTo ? chebyshevDist(fi.moveTo, me.pos) : before;
      const dir = after < before ? 'closing' : after > before ? 'fleeing' : 'holding';
      // Loose directional prior on the existing heatmap — not a point-mass.
      for (const [k, w] of predicted) {
        const [x, y] = k.split(',').map(Number);
        const near = chebyshevDist({ x, y }, foe.pos) <= 1;
        const closer = chebyshevDist({ x, y }, me.pos) < before;
        const mult = dir === 'holding' ? (near ? 1.6 : 0.8)
          : dir === 'closing' ? (closer ? 1.4 : 0.85)
          : (closer ? 0.85 : 1.4);   // fleeing
        predicted.set(k, w * mult);
      }
    }
  }

  const moveRange = effectiveMove(me.movementRange, meta.state);
  // Same-team units hard-block; a foe's square is "soft" — a square I can bet on
  // (it vacates if it moves, and I move second-ish in the contest), scored down by
  // the chance it stays. Size-1 movers only (the BFS guards multi-square anyway).
  const occupied = new Set<string>();
  const soft = new Set<string>();
  for (const c of session.combatants) {
    if (c.id === me.id) continue;
    const tgt = c.teamId === me.teamId ? occupied : soft;
    for (const cell of cellsOf(c)) tgt.add(key(cell));
  }
  const reach = reachableDanger(me.pos, moveRange, session.board, occupied, me.teamId, me.size, soft);
  const dests: { pos: Pos; info?: ReachDanger }[] = [{ pos: me.pos }];
  for (const r of reach.values()) dests.push({ pos: r.pos, info: r });

  const actions = collectAffordable(meta);
  // Priciest offensive action — restoring resource only earns credit when I can't
  // currently afford it (see scorePlan).
  const myMaxAtkCost = Math.max(0, ...[...meta.weapon.attack, ...meta.weapon.special].map(a => a.cost));

  let best: { score: number; tiebreak: number; intent: CombatIntent } | null = null;
  for (const d of dests) {
    const moveCost = d.info?.cost ?? 0;
    const isStay = d.pos.x === me.pos.x && d.pos.y === me.pos.y;
    for (const a of actions) {
      for (const target of candidateTargets(a.action, d.pos, predicted, session)) {
        const score = scorePlan(me, meta, foe, foeMeta, d.pos, d.info, a.action, target, predicted, session, myMaxAtkCost, a.choice, smart, foeMood, raceDefense);
        if (collect) collect.push({ dest: { ...d.pos }, choice: a.choice, index: a.index, action: a.action.name, target: target ? { ...target } : null, score });
        const tiebreak = -moveCost * 1000 - a.index;   // prefer staying / lower index
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && tiebreak > best.tiebreak)) {
          best = {
            score, tiebreak,
            intent: {
              combatantId: me.id,
              moveTo: isStay ? null : { ...d.pos },
              action: { type: a.choice, actionIndex: a.index, targetPos: target ? { ...target } : null },
            },
          };
        }
      }
    }
  }
  return best ? best.intent : pass(me.id);
}
