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
import { Pos, chebyshevDist } from './board.js';
import { hasLineOfSight } from './los.js';
import { reachableDanger, ReachDanger } from './movement.js';
import { effectiveMove } from './combatant_state.js';
import { areaBlock } from './resolution.js';
import Action, { ActionType, SELF_TARGET_TYPES } from '../weapon/action.js';

const key = (p: Pos) => `${p.x},${p.y}`;

// Tunable weights — the difficulty / personality dial.
const W = {
  heal: 0.8,
  defend: 1.0,
  control: 1.2,
  exposure: 1.0,
  hazardPath: 1.0,
  restore: 0.5,
  buff: 0.3,
  kill: 40,        // flat bonus for a likely kill
};
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
  const occupied = new Set(session.combatants.filter(c => c.id !== foe.id).map(c => key(c.pos)));
  const reach = reachableDanger(foe.pos, moveRange, session.board, occupied, foe.teamId);
  const foeRange = maxDamagingRange(foe);

  const raw = new Map<string, number>();
  let total = 0;
  const consider = (t: Pos) => {
    const d = chebyshevDist(t, me.pos);
    let w = (d <= foeRange && hasLineOfSight(t, me.pos, session.board))
      ? 3                                            // can hit me from here — prime spot
      : Math.max(0.2, 1.5 - 0.3 * (d - foeRange));   // gradient: closer to range = likelier
    const tile = session.board.getTile(t);
    if (tile && tile.kind === 'hazard' && tile.teamId === me.teamId) w *= 0.4;  // foes avoid my pits
    raw.set(key(t), (raw.get(key(t)) ?? 0) + w);
    total += w;
  };
  consider(foe.pos);                                 // staying put is always an option
  for (const r of reach.values()) consider(r.pos);

  if (total > 0) for (const [k, w] of raw) raw.set(k, w / total);
  return raw;
}

// The tiles an action touches when launched from `dest` at `target`.
function affectedKeys(action: Action, dest: Pos, target: Pos | null, session: CombatSession): Set<string> {
  if (action.aimed && action.area > 1 && target)            // aimed AOE: the block at the target
    return new Set(areaBlock(target, action.area, dest).filter(p => session.board.inBounds(p)).map(key));
  if (action.aimed && target)                               // aimed single: just the target tile
    return new Set([key(target)]);
  if (!action.aimed && action.area > 1)                     // reactive self-burst: block around me
    return new Set(areaBlock(dest, action.area, dest).filter(p => session.board.inBounds(p)).map(key));
  const disk = new Set<string>();                           // reactive single: the in-range disk
  for (let dx = -action.range; dx <= action.range; dx++)
    for (let dy = -action.range; dy <= action.range; dy++) {
      const p = { x: dest.x + dx, y: dest.y + dy };
      if (session.board.inBounds(p)) disk.add(key(p));
    }
  return disk;
}

// How much predicted player-mass an attack covers = its chance to connect.
function hitProb(action: Action, dest: Pos, target: Pos | null, predicted: Map<string, number>, session: CombatSession): number {
  let p = 0;
  for (const k of affectedKeys(action, dest, target, session)) p += predicted.get(k) ?? 0;
  return Math.min(1, p);
}

// Candidate target tiles for an aimed action from `dest`: the foe's likely
// squares in range + LOS. (Reactive / self-target take no target.)
function candidateTargets(action: Action, dest: Pos, predicted: Map<string, number>, session: CombatSession): (Pos | null)[] {
  if (!action.aimed) return [null];
  const out: Pos[] = [];
  for (const k of predicted.keys()) {
    const [x, y] = k.split(',').map(Number);
    const p = { x, y };
    const d = chebyshevDist(dest, p);
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
): number {
  const vuln = ESTIMATED_INCOMING / Math.max(1, meta.state.health);
  let score = 0;

  // --- offense: expected damage = EV × hit chance, with the resist roll-mode skew ---
  if (isDamaging(action)) {
    const mode = foeMeta?.state.get_roll_mode(action) ?? '1d';
    const evDmg = ev(fieldOf(action)) * roundsOf(action) * (ROLL_MULT[mode] ?? 1);
    const ph = hitProb(action, dest, target, predicted, session);
    score += evDmg * ph;
    if (ph > 0.5 && evDmg >= foe.hp) score += W.kill;                  // likely kill
    if (action.area > 1) {                                            // other foes caught now
      const cells = affectedKeys(action, dest, target, session);
      for (const e of session.combatants)
        if (e.teamId !== me.teamId && e.id !== foe.id && cells.has(key(e.pos))) score += evDmg;
    }
  }

  // --- sustain / defense, scaled by how vulnerable I am right now ---
  if (action.type === ActionType.Heal) {
    const missing = me.maxHp - meta.state.health;
    score += Math.min(valueOf(action), missing) * W.heal * (1 + vuln);
  }
  if (action.type === ActionType.Block || action.type === ActionType.Shield || action.type === ActionType.Reflect)
    score += Math.min(valueOf(action), ESTIMATED_INCOMING) * roundsOf(action) * vuln * W.defend;
  if (action.type === ActionType.Buff) score += valueOf(action) * W.buff;

  // --- control tiles: reward placement on the foe's likely path ---
  if ((action.type === ActionType.HazardTile || action.type === ActionType.SlowTile) && action.aimed && target) {
    let mass = 0;
    for (const p of areaBlock(target, action.area, dest)) mass += predicted.get(key(p)) ?? 0;
    const unit = action.type === ActionType.HazardTile ? valueOf(action) : 6;  // slow ≈ delay
    score += mass * unit * W.control;
  }
  if (action.type === ActionType.MoveDebuff)
    score += hitProb(action, dest, target, predicted, session) * roundsOf(action) * 4 * (W.control / 1.2);

  // --- positioning: the more fragile I am, the more I value distance from the
  // foe. A gradient (not a binary in/out of threat range) so a kiter keeps backing
  // to the edge of its own reach; a tank's vuln is tiny so it ignores this.
  score += vuln * chebyshevDist(dest, foe.pos) * W.exposure;

  // --- penalties / economy ---
  score -= (destInfo?.hazard ?? 0) * W.hazardPath;
  if (action.cost < 0)
    score += Math.min(meta.state.resource_max - meta.state.resource_current, -action.cost) * W.restore;

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

// Pick the best (destination, action, target) plan for `me` this turn.
// Deterministic: same board → same choice. Ties break toward less movement,
// then the lower action index.
export function choosePlan(me: Combatant, session: CombatSession): CombatIntent {
  const meta = session.meta.get(me.id);
  if (!meta) return pass(me.id);
  const enemies = session.combatants.filter(c => c.teamId !== me.teamId);
  if (enemies.length === 0) return pass(me.id);

  const foe = enemies.reduce((a, b) => chebyshevDist(me.pos, a.pos) <= chebyshevDist(me.pos, b.pos) ? a : b);
  const foeMeta = session.meta.get(foe.id);
  const predicted = predictPlayerTiles(me, foe, session);

  const moveRange = effectiveMove(me.movementRange, meta.state);
  const occupied = new Set(session.combatants.filter(c => c.id !== me.id).map(c => key(c.pos)));
  const reach = reachableDanger(me.pos, moveRange, session.board, occupied, me.teamId);
  const dests: { pos: Pos; info?: ReachDanger }[] = [{ pos: me.pos }];
  for (const r of reach.values()) dests.push({ pos: r.pos, info: r });

  const actions = collectAffordable(meta);

  let best: { score: number; tiebreak: number; intent: CombatIntent } | null = null;
  for (const d of dests) {
    const moveCost = d.info?.cost ?? 0;
    const isStay = d.pos.x === me.pos.x && d.pos.y === me.pos.y;
    for (const a of actions) {
      for (const target of candidateTargets(a.action, d.pos, predicted, session)) {
        const score = scorePlan(me, meta, foe, foeMeta, d.pos, d.info, a.action, target, predicted, session);
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
