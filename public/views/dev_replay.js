// View: Dev AI Replay — pick a weapon/enemy, run one spatial battle via the dev
// API, and step through it. Renders the board + combatant cards (HP/resource
// bars) like the real combat screen, plus the AI's reasoning: the predicted-
// movement heatmap (where a unit expects its foe to move — the dodge space) and
// every scored candidate plan, chosen highlighted. Click a card to inspect that
// unit's reasoning; click a turn in the log to jump. Dev-only; /api/dev/replay
// gates with isDev.
(function() {
  let data = null, turnIdx = 0, selUnit = null, root = null, autoTimer = null;
  const AUTO_MS = 20000; // auto-run dwell: hold each turn 20s before advancing
  const eq = (a, b) => (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const q = (sel) => root.querySelector(sel);
  const outcomeOf = (w) => w === 'team-a' ? 'player wins' : w === 'team-b' ? 'enemy wins' : 'timeout';

  async function mount(content) {
    root = content;
    root.innerHTML = `
      <div id="dr-shell">
        <div id="dr-controls">
          <label>Weapon <select id="dr-weapon"></select></label>
          <label>Enemy <select id="dr-enemy"></select></label>
          <button id="dr-run">Run battle</button>
          <span id="dr-status"></span>
        </div>
        <div id="dr-empty">Pick a weapon and an enemy, then <b>Run battle</b> to watch the AI fight it out.</div>
        <div id="dr-body" hidden>
          <div id="dr-left">
            <div id="dr-matchup"></div>
            <div id="dr-turnbar">
              <button id="dr-prev">◀</button>
              <span id="dr-turnlabel"></span>
              <button id="dr-next">▶</button>
              <button id="dr-auto" title="advance one turn every 20s">▶ Auto</button>
              <button id="dr-dl">⤓ Log</button>
              <span id="dr-hint">click a card to inspect its reasoning · ← / → or click a turn to step · cards/board show the state being decided on; the log is how it resolves</span>
            </div>
            <div id="dr-cards"></div>
            <div id="dr-board"></div>
          </div>
          <div id="dr-panel">
            <div id="dr-plan"></div>
            <div id="dr-heatinfo"></div>
            <h4>Scored plans (this unit, this turn)</h4>
            <div id="dr-cands"></div>
          </div>
          <div id="dr-logcol">
            <h4>Full log (click a turn to jump)</h4>
            <div id="dr-log"></div>
          </div>
        </div>
      </div>`;

    try {
      const res = await fetch('/api/dev/replay/options');
      if (res.status === 403) { q('#dr-status').textContent = 'Dev only.'; return; }
      const opt = await res.json();
      fillSelect('#dr-weapon', opt.weapons, 'branch');
      fillSelect('#dr-enemy', opt.enemies, 'lithkem_swallow');
    } catch (_) { q('#dr-status').textContent = 'Could not load options.'; return; }

    q('#dr-run').onclick = run;
    q('#dr-prev').onclick = () => step(-1);
    q('#dr-next').onclick = () => step(1);
    q('#dr-auto').onclick = toggleAuto;
    q('#dr-dl').onclick = downloadLog;
    document.addEventListener('keydown', onKey);
  }

  // Options are [{name, level}], already sorted by level then name from the API.
  function fillSelect(sel, items, def) {
    const el = q(sel);
    el.innerHTML = '';
    for (const it of items) {
      const o = document.createElement('option');
      o.value = it.name;
      o.textContent = `L${it.level} · ${it.name}`;
      if (it.name === def) o.selected = true;
      el.appendChild(o);
    }
  }

  function downloadLog() {
    if (!data) return;
    const m = data.meta;
    const lines = [`${m.weapon} (L${m.weaponLevel}) vs ${m.enemy} (L${m.enemyLevel}) — ${outcomeOf(data.result.winner)} (${data.result.rounds} rounds)`];
    for (const t of data.turns) {
      lines.push(`\n━━━ Turn ${t.n} ━━━`);
      for (const l of (t.log || [])) lines.push(l);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    a.download = `replay-${m.weapon}-vs-${m.enemy}.txt`.replace(/\s+/g, '_');
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onKey(e) {
    if (!data) return;
    // Don't hijack arrows while a dropdown/field is focused.
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'input' || tag === 'textarea') return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  }

  // Auto-run: advance one turn every AUTO_MS, stopping at the final turn.
  function toggleAuto() {
    if (autoTimer) { stopAuto(); return; }
    if (turnIdx >= data.turns.length - 1) return; // nothing left to play
    autoTimer = setInterval(() => {
      if (turnIdx >= data.turns.length - 1) { stopAuto(); return; }
      step(1);
    }, AUTO_MS);
    const b = q('#dr-auto');
    b.textContent = '⏸ Auto';
    b.classList.add('dr-auto-on');
  }

  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    const b = root && q('#dr-auto');
    if (b) { b.textContent = '▶ Auto'; b.classList.remove('dr-auto-on'); }
  }

  async function run() {
    stopAuto();
    const w = q('#dr-weapon').value, en = q('#dr-enemy').value;
    const status = q('#dr-status');
    status.textContent = 'running…';
    try {
      const res = await fetch(`/api/dev/replay?weapon=${encodeURIComponent(w)}&enemy=${encodeURIComponent(en)}`);
      if (!res.ok) { status.textContent = `error ${res.status}`; return; }
      data = await res.json();
      turnIdx = 0; selUnit = null;
      const m = data.meta;
      status.textContent = `${outcomeOf(data.result.winner)} in ${data.result.rounds} rounds`;
      q('#dr-matchup').innerHTML = `<b>${esc(m.weapon)}</b> <span class="dr-lvl">L${m.weaponLevel}</span> &nbsp;vs&nbsp; <b>${esc(m.enemy)}</b> <span class="dr-lvl">L${m.enemyLevel}</span>`;
      q('#dr-empty').hidden = true;
      q('#dr-body').hidden = false;
      renderFullLog();
      render();
    } catch (_) { status.textContent = 'error'; }
  }

  const turn = () => data.turns[turnIdx];
  const decisions = () => turn().decisions;
  const selDec = () => decisions().find((d) => d.unit === selUnit) || decisions()[0];

  function render() {
    if (!decisions().some((d) => d.unit === selUnit)) selUnit = decisions()[0] && decisions()[0].unit;
    q('#dr-turnlabel').textContent = `Turn ${turn().n} / ${data.turns.length}`;
    renderCards();
    renderBoard();
    renderPanel();
    highlightTurn();
  }

  // Combatant cards with HP/resource bars, styled like the real combat screen.
  function renderCards() {
    const t = turn();
    const el = q('#dr-cards');
    el.innerHTML = '';
    const acted = new Set(decisions().map((d) => d.unit));
    for (const u of t.units) {
      const own = u.team === 'team-a';
      const hpPct = Math.max(0, (u.hp / u.maxHp) * 100);
      const resPct = u.maxResource > 0 ? Math.max(0, (u.resource / u.maxResource) * 100) : 0;
      const hpColor = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';
      const lvl = own ? data.meta.weaponLevel : data.meta.enemyLevel;
      const card = document.createElement('div');
      card.className = `combatant-card ${own ? 'team-a' : 'team-b'}${u.id === selUnit ? ' dr-sel' : ''}`;
      card.innerHTML =
        `<h3>${esc(u.name)} <span class="dr-init" title="initiative — higher acts first">⚡${u.initiative}</span>${own ? '' : ' <span class="dr-ai">[AI]</span>'}</h3>` +
        `<div class="weapon-name">${esc(own ? data.meta.weapon : data.meta.enemy)} <span class="dr-lvl">L${lvl}</span></div>` +
        `<div class="hp-bar-bg"><div class="hp-bar" style="width:${hpPct}%;background:${hpColor}"></div></div>` +
        `<div class="hp-text">${u.hp} / ${u.maxHp} HP</div>` +
        `<div class="res-bar-bg"><div class="res-bar" style="width:${resPct}%"></div></div>` +
        `<div class="hp-text">${u.resource} / ${u.maxResource} ${esc(u.resourceName || '')}</div>` +
        (!own && u.telegraph ? `<div class="dr-telegraph">${esc(u.telegraph)}</div>` : '');
      if (acted.has(u.id)) card.onclick = () => { selUnit = u.id; render(); };
      else card.style.opacity = '0.6';
      el.appendChild(card);
    }
  }

  function renderBoard() {
    const W = data.meta.board.width, H = data.meta.board.height;
    const t = turn();
    const board = q('#dr-board');
    board.style.gridTemplateColumns = `repeat(${W}, var(--dr-cell))`;
    board.innerHTML = '';

    const dec = selDec();
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
        cell.classList.add(`tile-${tile.kind}`);
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
    const dec = selDec();
    if (!dec) { q('#dr-plan').textContent = ''; q('#dr-cands').innerHTML = ''; q('#dr-heatinfo').textContent = ''; return; }
    const c = dec.chosen;
    q('#dr-plan').innerHTML = `<b>chosen:</b> <span style="color:#4ad07a">${esc(c.choice)} ${esc(c.action)}</span>` +
      `${c.moveTo ? ` · move (${c.moveTo.x},${c.moveTo.y})` : ' · hold'}${c.target ? ` · aim (${c.target.x},${c.target.y})` : ''}`;

    const me = t.units.find((u) => u.id === dec.unit);
    const foe = t.units.find((u) => u.id === dec.foe);
    q('#dr-heatinfo').textContent = foe ? `🟧 heatmap = where ${me ? me.name : 'unit'} expects ${foe.name} to move (its dodge space)` : '';

    const cDest = c.moveTo || (me ? me.pos : null);
    let marked = false;
    const rows = dec.candidates.map((cand) => {
      const isChosen = !marked && cand.action === c.action && cand.choice === c.choice && eq(cand.dest, cDest) && eq(cand.target, c.target);
      if (isChosen) marked = true;
      return `<tr class="${isChosen ? 'chosen' : ''}"><td>${cand.score.toFixed(1)}</td><td>${esc(cand.choice)} ${esc(cand.action)}</td>` +
        `<td>(${cand.dest.x},${cand.dest.y})</td><td>${cand.target ? `(${cand.target.x},${cand.target.y})` : '—'}</td></tr>`;
    }).join('');
    q('#dr-cands').innerHTML = `<table><tr><th>score</th><th>plan</th><th>dest</th><th>aim</th></tr>${rows}</table>`;
  }

  // Full battle log, all turns — built once per run; clicking a turn jumps to it.
  function renderFullLog() {
    q('#dr-log').innerHTML = data.turns.map((t, i) =>
      `<div class="dr-turn" data-i="${i}"><div class="dr-turn-h">Turn ${t.n}</div>` +
      ((t.log || []).map((l) => `<div>${esc(l)}</div>`).join('') || '<div class="dr-noop">(nothing resolved)</div>') +
      `</div>`).join('');
    q('#dr-log').querySelectorAll('.dr-turn').forEach((d) => { d.onclick = () => { turnIdx = +d.dataset.i; render(); }; });
  }

  function highlightTurn() {
    const log = q('#dr-log');
    log.querySelectorAll('.dr-turn.cur').forEach((d) => d.classList.remove('cur'));
    const cur = log.querySelector(`.dr-turn[data-i="${turnIdx}"]`);
    if (!cur) return;
    cur.classList.add('cur');
    // Scroll only inside the log box — never use scrollIntoView, which would
    // yank the whole page down to the log on every step.
    const cr = cur.getBoundingClientRect(), lr = log.getBoundingClientRect();
    if (cr.top < lr.top) log.scrollTop -= lr.top - cr.top;
    else if (cr.bottom > lr.bottom) log.scrollTop += cr.bottom - lr.bottom;
  }

  function step(d) {
    if (!data) return;
    turnIdx = Math.max(0, Math.min(data.turns.length - 1, turnIdx + d));
    render();
  }

  function unmount() {
    stopAuto();
    document.removeEventListener('keydown', onKey);
    data = null; turnIdx = 0; selUnit = null; root = null;
  }

  window.Views = window.Views ?? {};
  window.Views.dev_replay = { mount, unmount };
})();
