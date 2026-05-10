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
  ui.phase = 'ended';
  const winnerTeam = state?.teams?.find(t => t.id === winner);
  appendLog([`━━━ Game Over! ${winnerTeam ? winnerTeam.name + ' wins!' : 'Draw!'} ━━━`], 'turn-divider');
  render();
});

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
function computeReachable(combatant) {
  const { width, height, obstacles } = state.board;
  const obstacleSet = new Set(
    obstacles.filter(o => o.state !== 'destroyed').map(o => `${o.pos.x},${o.pos.y}`)
  );
  const occupiedSet = new Set(
    state.combatants.filter(c => c.id !== combatant.id).map(c => `${c.pos.x},${c.pos.y}`)
  );
  const range = combatant.movementRange ?? 2;
  const startKey = `${combatant.pos.x},${combatant.pos.y}`;
  const stateCosts = new Map([[`${startKey}:0`, 0]]); // 'x,y:parity' → cost (BFS correctness)
  const tileCosts  = new Map([[startKey, 0]]);         // 'x,y' → best cost (parent tracking)
  const parents = new Map([[startKey, null]]);
  const queue = [[combatant.pos, 0, 0]]; // pos, cost, diagParity
  const reachable = new Set();

  while (queue.length) {
    const [pos, cost, diagParity] = queue.shift();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = pos.x + dx, ny = pos.y + dy;
        const k = `${nx},${ny}`;
        const isDiag = dx !== 0 && dy !== 0;
        const stepCost = isDiag ? (diagParity === 0 ? 1 : 2) : 1;
        const newCost = cost + stepCost;
        const newParity = isDiag ? 1 - diagParity : diagParity;
        const sk = `${k}:${newParity}`;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (obstacleSet.has(k)) continue;
        if (newCost > range) continue;
        if ((stateCosts.get(sk) ?? Infinity) <= newCost) continue;
        if (occupiedSet.has(k)) continue;
        stateCosts.set(sk, newCost);
        if (newCost < (tileCosts.get(k) ?? Infinity)) {
          tileCosts.set(k, newCost);
          parents.set(k, `${pos.x},${pos.y}`);
        }
        reachable.add(k);
        queue.push([{ x: nx, y: ny }, newCost, newParity]);
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
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 <  dx) { err += dx; y0 += sy; }
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
  const tiles = new Set();
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const k = `${x},${y}`;
      if (obstacleSet.has(k)) continue;
      const d = chebyshev(fromPos, { x, y });
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
  boardEl.style.gridTemplateColumns = `repeat(${width}, 72px)`;
  boardEl.innerHTML = '';

  const obstacleMap = new Map(obstacles.map(o => [`${o.pos.x},${o.pos.y}`, o]));
  const combatantMap = new Map(state.combatants.map(c => [`${c.pos.x},${c.pos.y}`, c]));
  const moveTargetKey = ui.moveTo ? `${ui.moveTo.x},${ui.moveTo.y}` : null;
  const selectedKey = ui.selected ? `${ui.selected.pos.x},${ui.selected.pos.y}` : null;
  const targetTileKey = ui.targetTile ? `${ui.targetTile.x},${ui.targetTile.y}` : null;
  const targetableTiles = (ui.phase === 'selecting_target' && ui.action)
    ? computeTargetableTiles(ui.action, ui.moveTo ?? ui.selected?.pos ?? { x: 0, y: 0 })
    : new Set();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = `${x},${y}`;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.coord = `${x},${y}`;

      const obstacle = obstacleMap.get(k);
      const combatant = combatantMap.get(k);

      if (obstacle) {
        cell.classList.add('obstacle');
        cell.dataset.state = obstacle.state;
      } else if (combatant) {
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

      if (k === targetTileKey) {
        cell.classList.add('target-selected');
      } else if (targetableTiles.has(k)) {
        cell.classList.add('target-valid');
      } else if (k === moveTargetKey) {
        cell.classList.add('move-target');
      } else if (ui.pathTiles.has(k) && !obstacle && !combatant) {
        cell.classList.add('path-tile');
      } else if (ui.reachable.has(k) && !ui.moveTo && !obstacle && !combatant) {
        cell.classList.add('reachable');
      }

      cell.addEventListener('click', () => onCellClick(x, y));
      boardEl.appendChild(cell);
    }
  }
}

function renderActionPanel() {
  actionPanelEl.innerHTML = '';

  if (ui.phase === 'waiting') {
    actionPanelEl.innerHTML = '<div class="action-title">Intent submitted — waiting for resolution…</div>';
    return;
  }
  if (ui.phase === 'ended') {
    actionPanelEl.innerHTML = '<div class="action-title">Battle ended.</div>';
    if (!isTutorial) {
      const hint = document.createElement('div');
      hint.className = 'action-title';
      hint.style.marginTop = '8px';
      hint.textContent = 'Return to Discord to start another battle.';
      actionPanelEl.appendChild(hint);
    }
    return;
  }

  if (ui.phase === 'selecting_target' && ui.action) {
    const row = document.createElement('div');
    row.className = 'action-buttons';

    const back = document.createElement('button');
    back.className = 'action-btn';
    back.textContent = '← Back';
    back.addEventListener('click', () => {
      ui.phase = 'selecting_action';
      ui.action = null;
      ui.targetTile = null;
      render();
    });
    row.appendChild(back);

    const title = document.createElement('div');
    title.className = 'action-title';
    title.textContent = ui.targetTile
      ? `${ui.action.label} → tile (${ui.targetTile.x},${ui.targetTile.y})`
      : `${ui.action.label} — click a tile to target`;
    row.appendChild(title);
    actionPanelEl.appendChild(row);

    if (ui.targetTile) {
      const submit = document.createElement('button');
      submit.className = 'submit-btn';
      submit.textContent = 'Submit Intent →';
      submit.addEventListener('click', submitIntent);
      actionPanelEl.appendChild(submit);
    }
    return;
  }

  if (ui.phase !== 'selecting_action' || !state) return;

  const player = myPlayerCombatant();
  if (!player?.weaponInfo) return;

  const fromPos = ui.moveTo ?? ui.selected?.pos;
  if (!fromPos) return;

  const title = document.createElement('div');
  title.className = 'action-title';
  title.textContent = ui.moveTo
    ? `Moving to (${ui.moveTo.x},${ui.moveTo.y}) — choose action`
    : 'Holding position — choose action';
  actionPanelEl.appendChild(title);

  const btns = document.createElement('div');
  btns.className = 'action-buttons';

  const allActions = [...player.weaponInfo.actions, PASS_ACTION];

  for (const action of allActions) {
    const canAfford = action.cost <= 0 || action.cost <= player.resource;
    const btn = document.createElement('button');
    btn.className = `action-btn${actionIsSelected(action) ? ' selected' : ''}${canAfford ? '' : ' unaffordable'}`;
    btn.textContent = action.label;
    if (!canAfford) btn.disabled = true;

    const parts = [];
    if (action.cost !== 0) parts.push(`${action.cost > 0 ? 'costs' : 'restores'} ${Math.abs(action.cost)} ${player.weaponInfo.resourceName}`);
    if (action.needsTarget) parts.push(`range ${action.range}`);
    if (parts.length) btn.title = parts.join(' · ');

    btn.addEventListener('click', () => {
      ui.action = action;
      ui.targetTile = null;
      if (action.needsTarget) {
        ui.phase = 'selecting_target';
        render();
      } else {
        renderActionPanel();
      }
    });
    btns.appendChild(btn);
  }
  actionPanelEl.appendChild(btns);

  if (ui.action && !ui.action.needsTarget) {
    const submit = document.createElement('button');
    submit.className = 'submit-btn';
    submit.textContent = 'Submit Intent →';
    submit.addEventListener('click', submitIntent);
    actionPanelEl.appendChild(submit);
  }
}

function renderCombatantList() {
  combatantListEl.innerHTML = '';
  if (!state) return;
  for (const c of state.combatants) {
    const isOwn = c.teamId === playerTeamId;
    const card = document.createElement('div');
    card.className = `combatant-card ${isOwn ? 'team-a' : 'team-b'}`;
    const hpPct  = Math.max(0, (c.hp / c.maxHp) * 100);
    const resPct = c.maxResource > 0 ? Math.max(0, (c.resource / c.maxResource) * 100) : 0;
    const hpColor = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';
    const telegraph = c.isAI && state.telegraphs?.[c.id];
    const weaponLine = (!c.isAI && c.weaponInfo) ? `<div class="weapon-name">${c.weaponInfo.name}</div>` : '';
    card.innerHTML = `
      <h3>${c.name}${c.isAI ? ' <span style="font-size:0.65rem;opacity:0.5">[AI]</span>' : ''}</h3>
      ${weaponLine}
      <div class="hp-bar-bg"><div class="hp-bar" style="width:${hpPct}%;background:${hpColor}"></div></div>
      <div class="hp-text">${c.hp} / ${c.maxHp} HP</div>
      <div class="res-bar-bg"><div class="res-bar" style="width:${resPct}%"></div></div>
      <div class="hp-text">${c.resource ?? '?'} / ${c.maxResource ?? '?'} ${c.resourceName ?? ''}</div>
      ${telegraph ? `<div class="telegraph">${telegraph}</div>` : ''}
    `;
    combatantListEl.appendChild(card);
  }
}

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
    if (clicked?.id === ui.selected?.id) {
      ui.phase = 'selecting_action';
      ui.action = null;
      ui.targetTile = null;
      render();
      return;
    }
    const fromPos = ui.moveTo ?? ui.selected?.pos;
    if (fromPos && ui.action && computeTargetableTiles(ui.action, fromPos).has(k)) {
      ui.targetTile = { x, y };
      render();
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
function appendLog(lines, cls = '') {
  for (const line of lines) {
    const p = document.createElement('p');
    const autoClass = line.startsWith('★') ? 'crit' : '';
    p.className = cls || autoClass;
    p.textContent = line;
    logEl.appendChild(p);
  }
  logEl.scrollTop = logEl.scrollHeight;
}
