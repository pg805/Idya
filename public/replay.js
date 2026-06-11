// Dev replay viewer for the spatial AI sim. Loads a replay.json (written by
// `node lib/tools/spatial_sim.js replay <enemy> <weapon>`) and steps through it
// turn-by-turn, drawing the board like a real battle plus the AI's reasoning:
// the predicted-movement heatmap (where the acting unit thinks its foe will go)
// and every scored candidate plan, with the chosen one highlighted.
let data = null, turnIdx = 0, selUnit = null;
const $ = (s) => document.querySelector(s);
const eq = (a, b) => (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y);

async function load() {
  try {
    const res = await fetch('replay.json');
    if (res.ok) { data = await res.json(); init(); return; }
  } catch (_) { /* fall through to file input */ }
  $('#title').textContent = 'AI Replay — load a replay.json →';
}

function init() {
  const w = data.result.winner;
  const outcome = w === 'team-a' ? 'player wins' : w === 'team-b' ? 'enemy wins' : 'timeout';
  $('#title').textContent = `${data.meta.weapon} vs ${data.meta.enemy} — ${outcome} (${data.result.rounds} rounds)`;
  turnIdx = 0; selUnit = null;
  render();
}

const turn = () => data.turns[turnIdx];
const decisions = () => turn().decisions;
function selectedDecision() {
  const d = decisions();
  return d.find((x) => x.unit === selUnit) || d[0];
}

function render() {
  if (!decisions().some((d) => d.unit === selUnit)) selUnit = decisions()[0] && decisions()[0].unit;
  $('#turnlabel').textContent = `Turn ${turn().n} / ${data.turns.length}`;
  renderBoard();
  renderPanel();
}

function renderBoard() {
  const W = data.meta.board.width, H = data.meta.board.height;
  const t = turn();
  const board = $('#board');
  board.style.gridTemplateColumns = `repeat(${W}, var(--cell-size))`;
  board.innerHTML = '';

  const dec = selectedDecision();
  const heat = new Map((dec && dec.predicted || []).map((p) => [`${p.x},${p.y}`, p.w]));
  const maxW = Math.max(0.0001, ...heat.values());
  const obs = new Map(t.board.obstacles.map((o) => [`${o.pos.x},${o.pos.y}`, o]));
  const tiles = new Map(t.board.tiles.map((tl) => [`${tl.pos.x},${tl.pos.y}`, tl]));
  const units = new Map(t.units.map((u) => [`${u.pos.x},${u.pos.y}`, u]));
  const c = dec && dec.chosen;
  const moveK = c && c.moveTo ? `${c.moveTo.x},${c.moveTo.y}` : null;
  const tgtK = c && c.target ? `${c.target.x},${c.target.y}` : null;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = `${x},${y}`;
    const cell = document.createElement('div');
    cell.className = 'cell';
    const o = obs.get(k);
    const solid = o && o.state !== 'destroyed';
    if (o) { cell.classList.add('obstacle'); cell.dataset.state = o.state; }
    const tile = tiles.get(k);
    if (tile && !solid) {
      cell.classList.add('tile', `tile-${tile.kind}`);
      const mark = document.createElement('div');
      mark.className = 'tile-mark';
      const sym = tile.kind === 'block' ? '🛡' : tile.kind === 'buff' ? '⚔' : tile.kind === 'slow' ? '🐌' : '⚠';
      mark.textContent = `${sym}${tile.value}`;
      cell.appendChild(mark);
    }
    const w = heat.get(k);
    if (w && !solid) cell.style.boxShadow = `inset 0 0 0 999px rgba(232,140,70,${(w / maxW * 0.6).toFixed(3)})`;
    const u = units.get(k);
    if (u && !solid) {
      const el = document.createElement('div');
      el.className = `combatant ${u.team === 'team-a' ? 'team-a' : 'team-b'}`;
      el.title = `${u.name} — ${u.hp}/${u.maxHp} HP, ${u.resource}/${u.maxResource}`;
      el.textContent = u.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
      cell.appendChild(el);
    }
    if (k === moveK) cell.classList.add('rp-move');
    if (k === tgtK) cell.classList.add('rp-target');
    board.appendChild(cell);
  }
}

function renderPanel() {
  const t = turn();
  const dec = selectedDecision();

  const sel = $('#unitsel');
  sel.innerHTML = '';
  for (const d of decisions()) {
    const u = t.units.find((x) => x.id === d.unit);
    const b = document.createElement('button');
    b.textContent = `${u ? u.name : d.unit} (${u ? u.hp : '?'} HP)`;
    b.className = d.unit === selUnit ? 'active' : '';
    b.onclick = () => { selUnit = d.unit; render(); };
    sel.appendChild(b);
  }

  if (!dec) { $('#plan').textContent = ''; $('#cands').innerHTML = ''; $('#heatinfo').textContent = ''; }
  else {
    const c = dec.chosen;
    $('#plan').innerHTML = `<b>chosen:</b> <span style="color:#4ad07a">${c.choice} ${c.action}</span>` +
      `${c.moveTo ? ` · move (${c.moveTo.x},${c.moveTo.y})` : ' · hold'}${c.target ? ` · aim (${c.target.x},${c.target.y})` : ''}`;

    const me = t.units.find((u) => u.id === dec.unit);
    const foe = t.units.find((u) => u.id === dec.foe);
    $('#heatinfo').textContent = foe ? `🟧 heatmap = where ${me ? me.name : 'unit'} expects ${foe.name} to move (its dodge space)` : '';

    const cDest = c.moveTo || (me ? me.pos : null);
    let marked = false;
    const rows = dec.candidates.map((cand) => {
      const isChosen = !marked && cand.action === c.action && cand.choice === c.choice && eq(cand.dest, cDest) && eq(cand.target, c.target);
      if (isChosen) marked = true;
      return `<tr class="${isChosen ? 'chosen' : ''}"><td>${cand.score.toFixed(1)}</td><td>${cand.choice} ${cand.action}</td>` +
        `<td>(${cand.dest.x},${cand.dest.y})</td><td>${cand.target ? `(${cand.target.x},${cand.target.y})` : '—'}</td></tr>`;
    }).join('');
    $('#cands').innerHTML = `<table><tr><th>score</th><th>plan</th><th>dest</th><th>aim</th></tr>${rows}</table>`;
  }

  $('#log').innerHTML = (t.log || []).map((l) => `<div>${l}</div>`).join('') || '<div style="opacity:.5">(nothing resolved)</div>';
}

function step(d) { turnIdx = Math.max(0, Math.min(data.turns.length - 1, turnIdx + d)); render(); }
document.addEventListener('keydown', (e) => {
  if (!data) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
});
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { data = JSON.parse(r.result); init(); };
  r.readAsText(f);
});
load();
