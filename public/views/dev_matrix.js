// View: Dev Sim Matrix — runs the full weapon×enemy spatial sweep via the dev API
// and shows the win%/timeout%/HP/rounds grid, color-coded. Same numbers as
// `spatial_sim.js all`, in the browser. Dev-only; /api/dev/matrix gates with isDev.
(function() {
  let data = null, root = null, stat = 'win';
  const q = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function mount(content) {
    root = content;
    root.innerHTML = `
      <div id="dm-shell">
        <div id="dm-controls">
          <label>Battles / matchup <input id="dm-n" type="number" value="20" min="5" max="50"></label>
          <label>Show <select id="dm-stat">
            <option value="win">win %</option>
            <option value="timeout">timeout %</option>
            <option value="hp">HP % on win</option>
            <option value="rounds">avg rounds</option>
          </select></label>
          <button id="dm-run">Run sweep</button>
          <span id="dm-status"></span>
        </div>
        <p id="dm-note">Both sides driven by the AI. Heavy — a sweep runs N battles for every weapon×enemy pair, so it takes a few seconds. Hover a cell for the full stats.</p>
        <div id="dm-table"></div>
      </div>`;
    q('#dm-run').onclick = run;
    q('#dm-stat').onchange = () => { stat = q('#dm-stat').value; if (data) renderTable(); };
  }

  async function run() {
    const n = Math.max(5, Math.min(50, +q('#dm-n').value || 20));
    const status = q('#dm-status');
    status.textContent = `running ${n}× per matchup… (this takes a bit)`;
    q('#dm-run').disabled = true;
    try {
      const res = await fetch(`/api/dev/matrix?n=${n}`);
      if (res.status === 403) { status.textContent = 'Dev only.'; return; }
      if (!res.ok) { status.textContent = `error ${res.status}`; return; }
      data = await res.json();
      status.textContent = `${data.n} battles/matchup · ${data.weapons.length} weapons × ${data.enemies.length} enemies`;
      renderTable();
    } catch (_) { status.textContent = 'error'; }
    finally { q('#dm-run').disabled = false; }
  }

  const cellVal = (s) => stat === 'win' ? s.winRate * 100 : stat === 'timeout' ? s.timeoutRate * 100 : stat === 'hp' ? s.avgHpOnWin * 100 : s.avgRounds;
  const cellText = (s) => stat === 'rounds' ? s.avgRounds.toFixed(0) : `${cellVal(s).toFixed(0)}%`;
  function cellColor(s) {
    if (stat === 'rounds') return '';
    let v = cellVal(s) / 100;            // 0..1
    if (stat === 'timeout') v = 1 - v;   // more timeout = worse = red
    const hue = Math.max(0, Math.min(120, v * 120));  // 0 red → 120 green
    return `background:hsl(${hue},45%,20%);color:hsl(${hue},65%,80%)`;
  }

  function renderTable() {
    const { weapons: W, enemies: E, cells: C } = data;
    let html = '<table id="dm-grid"><thead><tr><th class="dm-corner">Weapon</th>';
    for (const e of E) html += `<th>${esc(e.name)}<span class="dm-lvl">L${e.level}</span></th>`;
    html += '</tr></thead><tbody>';
    for (const w of W) {
      html += `<tr><th class="dm-w">${esc(w.name)} <span class="dm-lvl">L${w.level}</span></th>`;
      for (const e of E) {
        const s = C[w.name][e.name];
        const tip = `win ${(s.winRate * 100).toFixed(0)}% · ${s.avgRounds.toFixed(0)} rds · HP ${(s.avgHpOnWin * 100).toFixed(0)}% on win · t/o ${(s.timeoutRate * 100).toFixed(0)}%`;
        html += `<td style="${cellColor(s)}" title="${tip}">${cellText(s)}</td>`;
      }
      html += '</tr>';
    }
    q('#dm-table').innerHTML = html + '</tbody></table>';
  }

  function unmount() { data = null; root = null; }

  window.Views = window.Views ?? {};
  window.Views.dev_matrix = { mount, unmount };
})();
