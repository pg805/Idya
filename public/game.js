const socket = io();
let state = null;
let playerTeamId = null;
let isTutorial = false;

const PASS_ACTION = { label: 'Pass', choice: 'pass', index: 0, needsTarget: false, range: 0, cost: 0 };

const ui = {
  phase: 'idle',     // idle | selecting_move | selecting_action | selecting_target | waiting | ended
  selected: null,    // combatant object the player is controlling
  moveTo: null,      // {x, y} | null
  reachable: new Set(),
  moveParents: new Map(),
  pathTiles: new Set(),
  action: null,      // ActionInfo | null
  targetTile: null,  // {x, y} | null
};

// ---- DOM refs ----
const boardEl         = document.getElementById('board');
const actionPanelEl   = document.getElementById('action-panel');
const combatantListEl = document.getElementById('combatant-list');
const turnLabelEl     = document.getElementById('turn-label');
const phaseLabelEl    = document.getElementById('phase-label');
const connStatusEl    = document.getElementById('connection-status');
const logEl           = document.getElementById('combat-log');

// ---- Combat log filters ----
const LOG_FILTER_KEY = 'idya.log_filters';
// Mechanics (roll math) is opt-in — useful for debugging, noise for normal
// play. Everything else defaults visible.
const LOG_FILTER_DEFAULTS = { flavor: true, 'action-head': true, mechanics: false, move: true };
const LOG_FILTER_KEYS = Object.keys(LOG_FILTER_DEFAULTS);
function loadLogFilters() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOG_FILTER_KEY) ?? '{}');
    return { ...LOG_FILTER_DEFAULTS, ...stored };
  } catch (_) { return { ...LOG_FILTER_DEFAULTS }; }
}
function applyLogFilters(state) {
  for (const key of LOG_FILTER_KEYS) {
    logEl.classList.toggle(`hide-${key}`, state[key] === false);
    const box = document.querySelector(`#log-filters input[data-filter="${key}"]`);
    if (box) box.checked = state[key] !== false;
  }
}
(function initLogFilters() {
  const state = loadLogFilters();
  applyLogFilters(state);
  document.querySelectorAll('#log-filters input[data-filter]').forEach(box => {
    box.addEventListener('change', () => {
      const next = loadLogFilters();
      next[box.dataset.filter] = box.checked;
      localStorage.setItem(LOG_FILTER_KEY, JSON.stringify(next));
      applyLogFilters(next);
    });
  });
  // Download the full structured replay (board + roster + per-turn paths/actions
  // + the readable log) — a self-contained record that recreates the battle.
  // Falls back to a plain-text scrape if the server has no replay (e.g. an old
  // session that predates the feature).
  document.getElementById('log-download')?.addEventListener('click', async () => {
    const sessionId = window.location.pathname.split('/').pop() || 'test';
    try {
      const resp = await fetch(`/api/session/${sessionId}/replay`);
      if (resp.ok) {
        const replay = await resp.json();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' }));
        a.download = 'battle-replay.json';
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
    } catch { /* fall through to text scrape */ }
    const text = [...logEl.children].map(p => p.textContent).join('\n');
    if (!text) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'battle-log.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();

// ---- Socket ----
socket.on('connect', () => {
  connStatusEl.textContent = 'Connected';
  connStatusEl.className = 'connected';
  const sessionId = window.location.pathname.split('/').pop() || 'test';
  socket.emit('join_session', sessionId);
});

socket.on('disconnect', () => {
  connStatusEl.textContent = 'Disconnected';
  connStatusEl.className = 'disconnected';
});

// Server emits this with { message: 'Session X not found' } when the player
// reconnects to a battle whose in-memory state is gone — typically a bot
// restart, or a forfeit/cleanup from another tab. Bounce to /app so the
// layout endpoint can spin up a fresh tutorial (or land them on /character).
socket.on('error', ({ message }) => {
  if (message && message.toLowerCase().includes('not found')) {
    location.href = '/app/';
  }
});

socket.on('session_joined', ({ playerTeamId: tid, isTutorial: tutorial }) => {
  playerTeamId = tid;
  isTutorial = tutorial;
});

socket.on('session_state', (newState) => {
  const wasWaiting = ui.phase === 'waiting';
  state = newState;
  if (wasWaiting && state.phase === 'intent') resetUI();
  render();
});

socket.on('turn_result', ({ log }) => {
  appendLog(log);
});

socket.on('game_over', ({ winner }) => {
  const winnerTeam = state?.teams?.find(t => t.id === winner);
  resetUI();
  ui.phase = 'ended';
  appendLog([`━━━ Game Over! ${winnerTeam ? winnerTeam.name + ' wins!' : 'Draw!'} ━━━`], 'turn-divider');
  const ffBtn = document.getElementById('forfeit-btn');
  if (ffBtn) ffBtn.hidden = true;
  render();
});

// ---- Forfeit (button + 'F' keybind) ----
// Lives in the status bar so players always know they can leave a battle
// without backing out via Hunt. POSTs to the same endpoint the Hunt-page
// forfeit button uses; the server emits game_over({reason: 'forfeit'}),
// which lands here through the normal socket flow and ends the battle
// like any other game_over — player decides when to navigate away.
async function triggerForfeit() {
  if (ui.phase === 'ended') return;
  const btn = document.getElementById('forfeit-btn');
  if (btn?.disabled) return;
  if (!confirm('Forfeit this battle?')) return;
  if (btn) btn.disabled = true;
  const sessionId = window.location.pathname.split('/').pop();
  try {
    await fetch(`/api/active-battles/${sessionId}/forfeit`, { method: 'POST' });
  } catch (_) {
    if (btn) btn.disabled = false;
  }
}

(function wireForfeit() {
  const btn = document.getElementById('forfeit-btn');
  if (btn) btn.addEventListener('click', triggerForfeit);
  // Keybind: bare 'f' fires forfeit. Ignore when the user is typing somewhere
  // (no inputs in combat today, but future-proof anyway) and ignore the
  // modified variants so Ctrl+F / browser find still works.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    triggerForfeit();
  });
})();

socket.on('reward_result', ({ summary }) => {
  appendLog([summary], 'crit');
});

socket.on('tutorial_aside', ({ text, isOOC }) => {
  if (isOOC) {
    appendLog([text], 'tutorial-ooc');
  } else {
    appendLog([`Fendalok: "${text}"`], 'tutorial-aside');
  }
});

// ---- State helpers ----
function resetUI() {
  ui.phase = 'idle';
  ui.selected = null;
  ui.moveTo = null;
  ui.reachable = new Set();
  ui.moveParents = new Map();
  ui.pathTiles = new Set();
  ui.action = null;
  ui.targetTile = null;
}

function myPlayerCombatant() {
  if (!state || !playerTeamId) return null;
  return state.combatants.find(c => c.teamId === playerTeamId && !c.isAI) ?? null;
}

// ---- Movement BFS (mirrors server) ----
// Diagonals use alternating cost (1-2-1-2): even diagonal in path = 1, odd = 2.
// Hazard-aware movement search (mirrors server src/combat/movement.ts). Does a
// Pareto (movement-cost, hazard-damage) search so the previewed path — and the
// `parents` chain it reconstructs — routes around opposing hazard tiles (and slow,
// which is baked into cost) when a within-range detour exists. Reachability is
// unchanged (hazards alter the route, not which tiles are reachable). The server
// runs the same avoidance, so the green outline matches the damage actually taken.
function computeReachable(combatant) {
  const { width, height, obstacles } = state.board;
  const obstacleSet = new Set(
    obstacles.filter(o => o.state !== 'destroyed').map(o => `${o.pos.x},${o.pos.y}`)
  );
  const tiles = state.board.tiles || [];
  const slowSet = new Set(tiles.filter(t => t.kind === 'slow').map(t => `${t.pos.x},${t.pos.y}`));
  const hazardVal = new Map(); // 'x,y' → damage, opposing-team hazard tiles only
  for (const t of tiles) {
    if (t.kind === 'hazard' && t.teamId !== combatant.teamId) hazardVal.set(`${t.pos.x},${t.pos.y}`, t.value);
  }
  const occupiedSet = new Set(
    state.combatants.filter(c => c.id !== combatant.id).map(c => `${c.pos.x},${c.pos.y}`)
  );
  const range = combatant.movementRange ?? 2;
  const startKey = `${combatant.pos.x},${combatant.pos.y}`;

  // Pareto-optimal (cost, hazard) labels per 'x,y:parity'.
  const nondom = new Map();
  const dominated = (k, cost, hazard) => (nondom.get(k) || []).some(l => l.cost <= cost && l.hazard <= hazard);
  const record = (k, cost, hazard) => {
    const arr = (nondom.get(k) || []).filter(l => !(cost <= l.cost && hazard <= l.hazard));
    arr.push({ cost, hazard });
    nondom.set(k, arr);
  };

  const best = new Map();    // 'x,y' → {cost, hazard} chosen for display (least hazard, then cost)
  const parents = new Map([[startKey, null]]);
  const reachable = new Set();
  const frontier = [{ pos: combatant.pos, parity: 0, cost: 0, hazard: 0, parentKey: null }];

  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost || a.hazard - b.hazard);
    const cur = frontier.shift();
    const ck = `${cur.pos.x},${cur.pos.y}:${cur.parity}`;
    if (dominated(ck, cur.cost, cur.hazard)) continue;
    record(ck, cur.cost, cur.hazard);

    const tk = `${cur.pos.x},${cur.pos.y}`;
    if (cur.parentKey !== null) {  // skip the origin
      const prev = best.get(tk);
      if (!prev || cur.hazard < prev.hazard || (cur.hazard === prev.hazard && cur.cost < prev.cost)) {
        best.set(tk, { cost: cur.cost, hazard: cur.hazard });
        parents.set(tk, cur.parentKey);
        reachable.add(tk);
      }
    }

    const slowPenalty = slowSet.has(tk) ? 1 : 0;  // leaving a slow tile costs +1
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cur.pos.x + dx, ny = cur.pos.y + dy;
        const k = `${nx},${ny}`;
        const isDiag = dx !== 0 && dy !== 0;
        const stepCost = (isDiag ? (cur.parity === 0 ? 1 : 2) : 1) + slowPenalty;
        const newCost = cur.cost + stepCost;
        const newParity = isDiag ? 1 - cur.parity : cur.parity;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (obstacleSet.has(k)) continue;
        // No diagonal corner-cutting (mirrors server-side movement BFS).
        if (isDiag) {
          const ka = `${cur.pos.x},${ny}`, kb = `${nx},${cur.pos.y}`;
          if (obstacleSet.has(ka) && obstacleSet.has(kb)) continue;
        }
        if (newCost > range) continue;
        if (occupiedSet.has(k)) continue;
        const newHazard = cur.hazard + (hazardVal.get(k) || 0);
        if (dominated(`${k}:${newParity}`, newCost, newHazard)) continue;
        frontier.push({ pos: { x: nx, y: ny }, parity: newParity, cost: newCost, hazard: newHazard, parentKey: tk });
      }
    }
  }
  return { reachable, parents };
}

function getPathTiles(start, dest, parents) {
  const startKey = `${start.x},${start.y}`;
  const destKey = `${dest.x},${dest.y}`;
  const tiles = new Set();
  let current = parents.get(destKey);
  while (current && current !== startKey) {
    tiles.add(current);
    current = parents.get(current);
  }
  return tiles;
}

// ---- Action helpers ----
function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function hasLineOfSight(from, to, board) {
  const obstacleSet = new Set(
    board.obstacles.filter(o => o.state !== 'destroyed').map(o => `${o.pos.x},${o.pos.y}`)
  );
  let x0 = from.x, y0 = from.y;
  const x1 = to.x, y1 = to.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  const W = board.width, H = board.height;
  const inB = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    const advX = e2 > -dy;
    const advY = e2 <  dx;
    // Diagonal step — sight can't squeeze between two corner obstacles
    // (matches the no-corner-cut movement rule).
    if (advX && advY) {
      const ax = x0 + sx, ay = y0;
      const bx = x0, by = y0 + sy;
      if (inB(ax, ay) && inB(bx, by) && obstacleSet.has(`${ax},${ay}`) && obstacleSet.has(`${bx},${by}`)) return false;
    }
    if (advX) { err -= dy; x0 += sx; }
    if (advY) { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) break;
    if (obstacleSet.has(`${x0},${y0}`)) return false;
  }
  return true;
}

function computeTargetableTiles(actionInfo, fromPos) {
  if (!actionInfo.needsTarget) return new Set();
  const { width, height, obstacles } = state.board;
  const obstacleSet = new Set(
    obstacles.filter(o => o.state !== 'destroyed').map(o => `${o.pos.x},${o.pos.y}`)
  );
  // A blink-strike (moveTo) relocates you onto the aimed tile, so it can only
  // target an empty passable square — never one a combatant is standing on.
  const occupiedSet = actionInfo.moveTo
    ? new Set(state.combatants.filter(c => c.hp > 0).map(c => `${c.pos.x},${c.pos.y}`))
    : null;
  const tiles = new Set();
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const k = `${x},${y}`;
      const d = chebyshev(fromPos, { x, y });
      // Destroy Obstacle targets the obstacles themselves (any intact one in range).
      if (actionInfo.targetsObstacle) {
        if (obstacleSet.has(k) && d >= 1 && d <= actionInfo.range) tiles.add(k);
        continue;
      }
      if (obstacleSet.has(k)) continue;
      if (occupiedSet && occupiedSet.has(k)) continue;
      const minDist = actionInfo.canTargetSelf ? 0 : 1;
      if (d >= minDist && d <= actionInfo.range) {
        if (d === 0 || actionInfo.range === 1 || hasLineOfSight(fromPos, { x, y }, state.board)) {
          tiles.add(k);
        }
      }
    }
  }
  return tiles;
}

// Mirror of areaBlock() in resolution.ts — the N×N footprint of an Area action.
// Odd N centers on `center`; even N puts `center` at the corner nearest `caster`
// and sprays away. Off-board squares are dropped. Keep in sync with the server.
function areaCells(center, area, caster) {
  const out = new Set();
  const { width, height } = state.board;
  const add = (x, y) => { if (x >= 0 && x < width && y >= 0 && y < height) out.add(`${x},${y}`); };
  if (area % 2 === 1) {
    const off = (area - 1) / 2;
    for (let dx = 0; dx < area; dx++) for (let dy = 0; dy < area; dy++) add(center.x - off + dx, center.y - off + dy);
  } else {
    const dirX = Math.sign(center.x - caster.x) || 1;
    const dirY = Math.sign(center.y - caster.y) || 1;
    for (let i = 0; i < area; i++) for (let j = 0; j < area; j++) add(center.x + dirX * i, center.y + dirY * j);
  }
  return out;
}

// A reactive self-burst centers on the actor. Odd N needs no caster; even N
// sprays toward the nearest enemy (NW if none) — mirrors resolveReactiveStrike.
function selfBurstCaster(center, area) {
  if (area % 2 === 1) return center;
  const foes = state.combatants.filter(c => c.teamId !== playerTeamId);
  const foe = foes.length ? foes.reduce((a, b) => chebyshev(center, a.pos) <= chebyshev(center, b.pos) ? a : b).pos : null;
  const dx = foe ? (Math.sign(foe.x - center.x) || -1) : -1;
  const dy = foe ? (Math.sign(foe.y - center.y) || -1) : -1;
  return { x: center.x - dx, y: center.y - dy };
}

function actionIsSelected(action) {
  return ui.action && ui.action.choice === action.choice && ui.action.index === action.index;
}

// ---- Render ----
function render() {
  if (!state) return;
  turnLabelEl.textContent = `Turn ${state.turn + 1}`;
  phaseLabelEl.textContent = state.phase;
  renderBoard();
  renderActionPanel();
  renderCombatantList();
}

function renderBoard() {
  const { width, height, obstacles } = state.board;
  // Cell size comes from the --cell-size CSS variable so the mobile media
  // query can shrink the board (72px desktop, 44px phone) without JS knowing
  // about breakpoints. Re-read each render so a viewport resize takes effect.
  const cellSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell-size'), 10) || 72;
  boardEl.style.gridTemplateColumns = `repeat(${width}, ${cellSize}px)`;
  boardEl.innerHTML = '';

  const obstacleMap = new Map(obstacles.map(o => [`${o.pos.x},${o.pos.y}`, o]));
  const combatantMap = new Map(state.combatants.map(c => [`${c.pos.x},${c.pos.y}`, c]));
  const tileMap = new Map((state.board.tiles || []).map(t => [`${t.pos.x},${t.pos.y}`, t]));
  const moveTargetKey = ui.moveTo ? `${ui.moveTo.x},${ui.moveTo.y}` : null;
  const selectedKey = ui.selected ? `${ui.selected.pos.x},${ui.selected.pos.y}` : null;
  const targetTileKey = ui.targetTile ? `${ui.targetTile.x},${ui.targetTile.y}` : null;
  const targetableTiles = (ui.phase === 'selecting_target' && ui.action)
    ? computeTargetableTiles(ui.action, ui.moveTo ?? ui.selected?.pos ?? { x: 0, y: 0 })
    : new Set();

  // Preview the blast footprint of an AOE the player is lining up: an aimed AOE
  // around the chosen target tile, a reactive self-burst around the player's own
  // (post-move) square. Lets you see what the area will hit before submitting.
  const aoeFrom = ui.moveTo ?? ui.selected?.pos ?? { x: 0, y: 0 };
  let areaFootprint = new Set();
  if (ui.action && ui.action.area > 1) {
    if (ui.action.selfBurst && ui.phase === 'selecting_action')
      areaFootprint = areaCells(aoeFrom, ui.action.area, selfBurstCaster(aoeFrom, ui.action.area));
    else if (ui.action.needsTarget && ui.targetTile && ui.phase === 'selecting_target')
      areaFootprint = areaCells(ui.targetTile, ui.action.area, aoeFrom);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.coord = `${x},${y}`;

      const obstacle = obstacleMap.get(k);
      const combatant = combatantMap.get(k);
      const tile = tileMap.get(k);
      // A destroyed obstacle is walkable rubble — still drawn, but it behaves like
      // an empty tile (tokens + tiles can sit on it). Only intact/damaged walls block.
      const solidObstacle = obstacle && obstacle.state !== 'destroyed';

      if (obstacle) {
        cell.classList.add('obstacle');
        cell.dataset.state = obstacle.state;   // bottom layer (rubble when destroyed)
      }

      if (!solidObstacle) {
        if (tile) {  // middle layer: tile tint + mark (z-index in CSS keeps it above rubble)
          cell.classList.add('tile', `tile-${tile.kind}`, tile.teamId === playerTeamId ? 'tile-ally' : 'tile-foe');
          const mark = document.createElement('div');
          mark.className = 'tile-mark';
          const sym = tile.kind === 'block' ? '🛡' : tile.kind === 'buff' ? '⚔' : tile.kind === 'slow' ? '🐌' : '⚠';
          mark.textContent = `${sym}${tile.value}`;
          cell.appendChild(mark);
        }
        if (combatant) {  // top layer: token
          const isOwn = combatant.teamId === playerTeamId;
          const el = document.createElement('div');
          el.className = `combatant ${isOwn ? 'team-a' : 'team-b'}${k === selectedKey ? ' selected' : ''}`;
          if (combatant.sprite) {
            el.style.backgroundImage = `url('${combatant.sprite}')`;
            el.style.backgroundSize = 'contain';
            el.style.backgroundRepeat = 'no-repeat';
            el.style.backgroundPosition = 'center';
            el.innerHTML = `<span class="combatant-name">${combatant.name}</span>`;
          } else {
            const initials = combatant.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            el.innerHTML = `${initials}<span class="combatant-name">${combatant.name}</span>`;
          }
          cell.appendChild(el);
        }
      }

      if (k === targetTileKey) {
        cell.classList.add('target-selected');
        if (ui.action?.moveTo) cell.classList.add('target-blink');
      } else if (targetableTiles.has(k)) {
        cell.classList.add('target-valid');
        if (ui.action?.moveTo) cell.classList.add('target-blink');
      } else if (k === moveTargetKey) {
        cell.classList.add('move-target');
      } else if (ui.pathTiles.has(k) && !solidObstacle && !combatant) {
        cell.classList.add('path-tile');
      } else if (ui.reachable.has(k) && ui.phase === 'selecting_move' && !solidObstacle && !combatant) {
        // Keep reachable highlights up through the whole selecting_move phase
        // (used to clear once moveTo was set) so arrow-key users can see how
        // far they can still go from the current target.
        cell.classList.add('reachable');
      }

      // Overlay: any square the lined-up AOE will hit (coexists with other marks).
      if (areaFootprint.has(k)) cell.classList.add('area-footprint');

      cell.addEventListener('click', () => onCellClick(x, y));
      boardEl.appendChild(cell);
    }
  }
}

// A stat { value, mods } → plain effect text + an outline-pill box per modifier.
function statHtml(stat) {
  if (!stat) return '';
  const value = stat.value ? `<span class="stat-value">${stat.value}</span>` : '';
  const mods = (stat.mods || []).map(m => `<span class="stat-pill">${m}</span>`).join('');
  return value + mods;
}

function renderActionPanel() {
  actionPanelEl.innerHTML = '';
  actionPanelEl.classList.remove('active', 'dim');

  if (ui.phase === 'ended') {
    // Keep the panel the exact size it was during the battle (the locked height)
    // and fill it with one big return button — no "Battle ended" text, no jump.
    // Tutorial drops you on the character page so app.js fires the town tour.
    const again = document.createElement('a');
    again.className = 'return-big';
    again.href = isTutorial ? '/app/character?tour=1' : '/app/hunt';
    again.innerHTML = `${isTutorial ? 'Go to Town' : 'Return to Town'} <span class="action-key">↵</span>`;
    actionPanelEl.appendChild(again);
    return;
  }

  // Every phase but "ended" shows the action list. LIT when it's your turn to
  // pick or aim (selecting_action / selecting_target), DIMMED otherwise. There's
  // NO header at any stage — the panel sizes to the list and stays put, and the
  // board (highlighted target tiles) guides aiming. A chosen aimed action stays
  // highlighted in the list while you click its target tile on the board.
  const active = ui.phase === 'selecting_action' || ui.phase === 'selecting_target';
  actionPanelEl.classList.add(active ? 'active' : 'dim');

  if (!state) return;
  const player = myPlayerCombatant();
  if (!player?.weaponInfo) return;

  // Grouped action list: one block per category (defend / attack / special), each
  // headed by that category's crit + the triangle condition that fires it. Number
  // keys map to the flat actions order (defend→attack→special→pass), so the row
  // number = the action's global index, preserved across the visual grouping.
  const CAT = {
    defend:  { label: 'Defend',  icon: '🛡', arrow: '⤵', trigger: 'if the foe attacks' },
    attack:  { label: 'Attack',  icon: '⚔', arrow: '⤴', trigger: 'if the foe uses a Special' },
    special: { label: 'Special', icon: '✦', arrow: '✦', trigger: 'if the foe guards' },
  };
  const acts = player.weaponInfo.actions;
  const crits = player.weaponInfo.crits || {};

  const renderRow = (action, num, canAfford) => {
    const isPass = action.choice === 'pass';
    const row = document.createElement('button');
    row.className = `action-row${isPass ? ' pass-row' : ''}${actionIsSelected(action) ? ' selected' : ''}${canAfford ? '' : ' unaffordable'}`;
    if (!canAfford) row.disabled = true;
    const costHtml = isPass ? ''
      : action.cost === 0 ? '<span class="action-cost free">free</span>'
      : `<span class="action-cost${action.cost < 0 ? ' gain' : ''}">${action.cost < 0 ? '+' + (-action.cost) : action.cost}</span>`;
    row.innerHTML =
        `<span class="action-key">${num <= 9 ? num : ''}</span>`
      + `<span class="action-label">${action.label}</span>`
      + `<span class="action-stat">${statHtml(action.stat)}</span>`
      + costHtml;
    if (!isPass && action.cost !== 0) row.title = `${action.cost > 0 ? 'costs' : 'restores'} ${Math.abs(action.cost)} ${player.weaponInfo.resourceName}${action.needsTarget ? ' · range ' + action.range : ''}`;
    else if (action.needsTarget) row.title = `range ${action.range}`;
    row.addEventListener('click', () => pickAction(action));
    return row;
  };

  const list = document.createElement('div');
  list.className = 'action-list';

  for (const cat of ['defend', 'attack', 'special']) {
    const rows = acts.map((a, idx) => ({ a, idx })).filter(x => x.a.choice === cat);
    if (rows.length === 0) continue;
    const group = document.createElement('div');
    group.className = `action-group group-${cat}`;

    const head = document.createElement('div');
    head.className = 'action-group-head';
    const c = CAT[cat];
    head.innerHTML = `<span class="cat-name">${c.icon} ${c.label}</span>`
      + (crits[cat]?.length
          ? `<span class="cat-crit"><span class="crit-arrow">${c.arrow}</span> `
            + crits[cat].map(cr => `<span class="crit-name">${cr.name}</span>${statHtml(cr.stat)}`).join(' ')
            + `</span>`
          : '');
    group.appendChild(head);

    for (const { a, idx } of rows) {
      const canAfford = a.cost <= 0 || a.cost <= player.resource;
      group.appendChild(renderRow(a, idx + 1, canAfford));
    }
    list.appendChild(group);
  }

  // Pass is not an offered option — by design every weapon always has an
  // affordable action (a restore / free defend). Only fall back to it if nothing
  // at all is affordable, so a 0-resource edge case can't soft-lock the turn.
  if (!acts.some(a => a.cost <= 0 || a.cost <= player.resource))
    list.appendChild(renderRow(PASS_ACTION, acts.length + 1, true));
  actionPanelEl.appendChild(list);

  // Lock the panel to its current list height so it never resizes — including the
  // end-of-battle return button. Reset first, then re-measure each turn, so a
  // layout-width change that re-wraps the rows can't leave a stale (too-small)
  // lock that makes the panel shrink (jump) at battle end.
  actionPanelEl.style.minHeight = '';
  actionPanelEl.style.minHeight = actionPanelEl.offsetHeight + 'px';
}

function statusBadgesHtml(status) {
  if (!status) return '';
  const badges = [];
  // Block carries no rounds — it resets at end of turn — show as a single value.
  if (status.block > 0)         badges.push(`<span class="badge badge-block">🛡 ${status.block}</span>`);
  if (status.shield?.rounds > 0)  badges.push(`<span class="badge badge-shield">◆ ${status.shield.value} <i>${status.shield.rounds}r</i></span>`);
  if (status.dot?.rounds > 0)     badges.push(`<span class="badge badge-dot">☠ ${status.dot.value} <i>${status.dot.rounds}r</i></span>`);
  if (status.buff?.rounds > 0)    badges.push(`<span class="badge badge-buff">▲ ${status.buff.value} <i>${status.buff.rounds}r</i></span>`);
  if (status.debuff?.rounds > 0)  badges.push(`<span class="badge badge-debuff">▼ ${status.debuff.value} <i>${status.debuff.rounds}r</i></span>`);
  if (status.reflect?.rounds > 0) badges.push(`<span class="badge badge-reflect">↺ ${status.reflect.value} <i>${status.reflect.rounds}r</i></span>`);
  if (status.moveDebuff?.rounds > 0) badges.push(`<span class="badge badge-movedebuff">🐌 →${status.moveDebuff.value} <i>${status.moveDebuff.rounds}r</i></span>`);
  return badges.length ? `<div class="status-badges">${badges.join('')}</div>` : '';
}

// Every combatant we've seen this battle, in first-seen order. The server drops
// dead units from `state.combatants`, so we keep their last snapshot here and
// keep their card on screen (at 0 HP, greyed) rather than vanishing it.
const seenCombatants = new Map();

function renderCombatantList() {
  combatantListEl.innerHTML = '';
  if (!state) return;
  const live = new Map(state.combatants.map(c => [c.id, c]));
  for (const c of state.combatants) seenCombatants.set(c.id, c);   // refresh + record order

  for (const [id, snap] of seenCombatants) {
    const cur = live.get(id);
    const defeated = !cur;
    const c = cur ?? { ...snap, hp: 0 };
    const isOwn = c.teamId === playerTeamId;
    const card = document.createElement('div');
    card.className = `combatant-card ${isOwn ? 'team-a' : 'team-b'}${defeated ? ' defeated' : ''}`;
    const hpPct  = Math.max(0, (c.hp / c.maxHp) * 100);
    const resPct = c.maxResource > 0 ? Math.max(0, (c.resource / c.maxResource) * 100) : 0;
    const hpColor = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';
    const telegraph = !defeated && c.isAI && state.telegraphs?.[c.id];
    const weaponLine = (!c.isAI && c.weaponInfo) ? `<div class="weapon-name">${c.weaponInfo.name}</div>` : '';
    card.innerHTML = `
      <h3>${c.name} <span class="init-badge" title="initiative — higher acts first">⚡${c.initiative}</span>${c.isAI ? ' <span style="font-size:0.65rem;opacity:0.5">[AI]</span>' : ''}</h3>
      ${weaponLine}
      <div class="hp-bar-bg"><div class="hp-bar" style="width:${hpPct}%;background:${hpColor}"></div></div>
      <div class="hp-text">${c.hp} / ${c.maxHp} HP${defeated ? ' — defeated' : ''}</div>
      <div class="res-bar-bg"><div class="res-bar" style="width:${resPct}%"></div></div>
      <div class="hp-text">${c.resource ?? '?'} / ${c.maxResource ?? '?'} ${c.resourceName ?? ''}</div>
      ${defeated ? '' : statusBadgesHtml(c.status)}
      ${telegraph ? `<div class="telegraph">${telegraph}</div>` : ''}
    `;
    combatantListEl.appendChild(card);
  }
}

// Shared action picker — used by both click handlers and keyboard shortcuts.
function pickAction(action) {
  if (!action) return;
  const player = myPlayerCombatant();
  if (!player) return;
  const canAfford = action.cost <= 0 || action.cost <= player.resource;
  if (!canAfford) return;
  ui.action = action;
  ui.targetTile = null;
  if (action.needsTarget) {
    ui.phase = 'selecting_target';
    render();
  } else {
    // Clicking the action IS the confirm — no separate submit step.
    submitIntent();
  }
}

// ---- Keyboard ----
// Arrow keys move the moveTo target (or the targetTile during aimed attacks).
// Number keys 1-9 pick an action by visible order. Enter submits when the
// intent is complete, Escape backs out one step.
function onKey(e) {
  if (!state) return;
  // Don't intercept typing in inputs (currently none on the battle page, but defensive)
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  // Post-battle: Enter follows the Return/Go to Town link
  if (ui.phase === 'ended') {
    if (e.key === 'Enter' || e.key === ' ') {
      const link = actionPanelEl.querySelector('a.return-big, a.battle-again-btn');
      if (link?.href) {
        e.preventDefault();
        location.href = link.href;
      }
    }
    return;
  }

  if (state.phase !== 'intent' || ui.phase === 'waiting') return;

  const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  const dy = e.key === 'ArrowUp'   ? -1 : e.key === 'ArrowDown'  ? 1 : 0;

  // --- Movement phases ---
  if (ui.phase === 'idle' || ui.phase === 'selecting_move' || ui.phase === 'selecting_action') {
    if (dx !== 0 || dy !== 0) {
      e.preventDefault();
      // Auto-select the player's combatant if nothing is selected yet
      if (ui.phase === 'idle') {
        const player = myPlayerCombatant();
        if (!player) return;
        ui.selected = player;
        const { reachable, parents } = computeReachable(player);
        ui.reachable = reachable;
        ui.moveParents = parents;
        ui.phase = 'selecting_move';
      }
      if (!ui.selected) return;
      const from = ui.moveTo ?? ui.selected.pos;
      const cand = { x: from.x + dx, y: from.y + dy };
      const k = `${cand.x},${cand.y}`;
      const origin = ui.selected.pos;
      if (cand.x === origin.x && cand.y === origin.y) {
        // Moving back to the starting tile = stay put
        ui.moveTo = null;
        ui.pathTiles = new Set();
        if (ui.phase === 'selecting_action') ui.phase = 'selecting_move';
      } else if (ui.reachable.has(k)) {
        ui.moveTo = cand;
        ui.pathTiles = getPathTiles(origin, cand, ui.moveParents);
        if (ui.phase === 'selecting_action') ui.phase = 'selecting_move';
      } else {
        return;
      }
      render();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      // From idle -> select the player's combatant and skip straight to the
      // action phase. Lets keyboard users hold position without arrowing back
      // to the start tile.
      if (ui.phase === 'idle') {
        const player = myPlayerCombatant();
        if (!player) return;
        e.preventDefault();
        ui.selected = player;
        const { reachable, parents } = computeReachable(player);
        ui.reachable = reachable;
        ui.moveParents = parents;
        ui.phase = 'selecting_action';
        render();
        return;
      }
      // From selecting_move -> selecting_action (confirm move + start picking action)
      if (ui.phase === 'selecting_move') {
        e.preventDefault();
        ui.phase = 'selecting_action';
        render();
        return;
      }
      // From selecting_action with an action set + no target needed -> submit
      if (ui.phase === 'selecting_action' && ui.action && !ui.action.needsTarget) {
        e.preventDefault();
        submitIntent();
        return;
      }
    }
    // Numbers 1-9 pick an action while choosing one
    if (ui.phase === 'selecting_action') {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const player = myPlayerCombatant();
        if (!player?.weaponInfo) return;
        const action = player.weaponInfo.actions[num - 1];
        if (action) pickAction(action);
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (ui.phase === 'selecting_action') {
        ui.phase = 'selecting_move';
        ui.action = null;
        render();
      } else if (ui.phase === 'selecting_move') {
        resetUI();
        render();
      }
      return;
    }
  }

  // --- Target-selection phase ---
  if (ui.phase === 'selecting_target' && ui.action) {
    if (e.key === 'Enter' || e.key === ' ') {
      if (ui.targetTile) { e.preventDefault(); submitIntent(); }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      ui.phase = 'selecting_action';
      ui.action = null;
      ui.targetTile = null;
      render();
      return;
    }
    if (dx !== 0 || dy !== 0) {
      e.preventDefault();
      const fromPos = ui.moveTo ?? ui.selected?.pos;
      if (!fromPos) return;
      const targetable = computeTargetableTiles(ui.action, fromPos);
      const seed = ui.targetTile ?? fromPos;
      const cand = { x: seed.x + dx, y: seed.y + dy };
      if (targetable.has(`${cand.x},${cand.y}`)) {
        ui.targetTile = cand;
        render();
      }
      return;
    }
  }
}
document.addEventListener('keydown', onKey);

// ---- Interaction ----
function onCellClick(x, y) {
  if (!state || state.phase !== 'intent') return;
  if (ui.phase === 'waiting' || ui.phase === 'ended') return;

  const k = `${x},${y}`;
  const clicked = state.combatants.find(c => c.pos.x === x && c.pos.y === y);

  if (ui.phase === 'idle') {
    if (clicked && clicked.teamId === playerTeamId && !clicked.isAI) {
      ui.selected = clicked;
      const { reachable, parents } = computeReachable(clicked);
      ui.reachable = reachable;
      ui.moveParents = parents;
      ui.phase = 'selecting_move';
      render();
    }
    return;
  }

  if (ui.phase === 'selecting_move') {
    if (clicked?.id === ui.selected?.id) {
      ui.moveTo = null;
      ui.phase = 'selecting_action';
      render();
      return;
    }
    if (ui.reachable.has(k)) {
      ui.moveTo = { x, y };
      ui.pathTiles = getPathTiles(ui.selected.pos, { x, y }, ui.moveParents);
      ui.phase = 'selecting_action';
      render();
      return;
    }
    return;
  }

  if (ui.phase === 'selecting_action') {
    if (clicked?.id === ui.selected?.id) {
      ui.moveTo = null;
      ui.pathTiles = new Set();
      ui.action = null;
      const { reachable, parents } = computeReachable(ui.selected);
      ui.reachable = reachable;
      ui.moveParents = parents;
      ui.phase = 'selecting_move';
      render();
    }
    return;
  }

  if (ui.phase === 'selecting_target') {
    // Don't bump back to action select on own-tile click — the Back button does
    // that, and intercepting clicks here blocks legitimate target-tile picks
    // (incl. self-targeting Heal/Buff actions).
    const fromPos = ui.moveTo ?? ui.selected?.pos;
    if (fromPos && ui.action && computeTargetableTiles(ui.action, fromPos).has(k)) {
      ui.targetTile = { x, y };
      // Picking the target tile IS the confirm — submit straight away.
      submitIntent();
    }
    return;
  }
}

function submitIntent() {
  if (!ui.selected || !ui.action || !state) return;

  let targetPos = null;
  if (ui.action.needsTarget) {
    if (!ui.targetTile) return;
    targetPos = { ...ui.targetTile };
  }

  const sessionId = window.location.pathname.split('/').pop() || 'test';
  socket.emit('submit_intent', {
    sessionId,
    intent: {
      combatantId: ui.selected.id,
      moveTo: ui.moveTo,
      action: {
        type: ui.action.choice,
        actionIndex: ui.action.index,
        targetPos,
      },
    },
  });

  appendLog([`━━━ Turn ${state.turn + 1} ━━━`], 'turn-divider');
  ui.phase = 'waiting';
  renderActionPanel();
}

// ---- Reset ----
function resetSession() {
  const sessionId = window.location.pathname.split('/').pop() || 'test';
  logEl.innerHTML = '';
  resetUI();
  socket.emit('reset_session', sessionId);
}

// ---- Log ----
// Categories drive CSS styling AND the filter checkboxes in the log header:
//   turn-divider  — turn separators (━━━ Turn N ━━━, ━━━ Game Over ━━━)
//   phase-header  — sub-phase markers (▸ Move / ▸ Defend / ▸ Attack / ▸ Special)
//   crit          — ★ critical-hit announcements
//   status        — deaths, expirations
//   move          — "<Name> moves to (x,y)"
//   action-head   — main per-action lines (the source-of-truth row)
//   mechanics     — indented detail under an action (roll math)
//   flavor        — indented narrative prose under an action
function classifyLogLine(line) {
  if (line.startsWith('━━━'))                                 return 'turn-divider';
  if (line.startsWith('▸ '))                                   return 'phase-header';
  if (line.startsWith('★'))                                    return 'crit';
  if (line.includes('is defeated'))                            return 'status';
  if (/^[^\s].* moves to \(\d+,\d+\)$/.test(line))             return 'move';
  if (line.startsWith('  ↺'))                                  return 'mechanics';      // reflect bounce
  if (line.startsWith('    roll '))                            return 'mechanics';      // roll math
  if (line.startsWith('    '))                                 return 'mechanics';      // deeper indent = detail
  if (/^.+? — .+:/.test(line) && !line.startsWith('  '))       return 'action-head';     // "<Actor> — <Action>: <result>"
  if (/expired|wore off/i.test(line))                          return 'status';
  // Default: indented narrative prose under an action line.
  return 'flavor';
}

function appendLog(lines, cls = '') {
  for (const line of lines) {
    const p = document.createElement('p');
    p.className = cls || classifyLogLine(line);
    p.textContent = line;
    logEl.appendChild(p);
  }
  logEl.scrollTop = logEl.scrollHeight;
}
