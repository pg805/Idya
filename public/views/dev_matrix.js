// View: Dev Sim Matrix — the canonical weapon×enemy win%/timeout grid for this
// version, read STATICALLY from /dev-matrix.json (generated at version bump via
// `npm run matrix:save`, so the page costs nothing to load). A "re-run live"
// button hits /api/dev/matrix for a fresh sweep when iterating. Player side plays
// the smart (human-stand-in) AI; the enemy uses the shippable AI.
(function() {
  let data = null, root = null, stat = 'win';
  const q = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  async function mount(content) {
    root = content;
    root.innerHTML = `
      <div id="dm-shell">
        <div id="dm-controls">
          <label>Show <select id="dm-stat">
            <option value="win">win %</option>
            <option value="timeout">timeout %</option>
            <option value="hp">HP % on win</option>
            <option value="rounds">avg rounds</option>
          </select></label>
          <span class="dm-sep"></span>
          <label>Live re-run <input id="dm-n" type="number" value="20" min="5" max="50"></label>
          <button id="dm-run">Re-run live</button>
          <span id="dm-status"></span>
        </div>
        <p id="dm-note">Canonical numbers for this version (static). Player side plays the smart human-stand-in AI; the enemy uses the shippable AI. Hover a cell for full stats. Re-run live for a fresh sweep while iterating.</p>
        <div id="dm-table"></div>
      </div>`;
    q('#dm-stat').onchange = () => { stat = q('#dm-stat').value; if (data) renderTable(); };
    q('#dm-run').onclick = runLive;

    // Load the committed canonical matrix — no server compute.
    try {
      const res = await fetch('/dev-matrix.json', { cache: 'no-cache' });
      if (res.ok) { data = await res.json(); setStatus(`canonical v${data.version} · ${data.n} battles/matchup · ${data.generated}`); renderTable(); }
      else setStatus('no canonical matrix yet — run `npm run matrix:save`, or re-run live.');
    } catch (_) { setStatus('no canonical matrix — re-run live.'); }
  }

  const setStatus = (t) => { q('#dm-status').textContent = t; };

  async function runLive() {
    const n = Math.max(5, Math.min(50, +q('#dm-n').value || 20));
    setStatus(`running ${n}× per matchup live… (a few seconds)`);
    q('#dm-run').disabled = true;
    try {
      const res = await fetch(`/api/dev/matrix?n=${n}`);
      if (res.status === 403) { setStatus('Dev only.'); return; }
      if (!res.ok) { setStatus(`error ${res.status}`); return; }
      data = await res.json();
      setStatus(`live · ${data.n} battles/matchup`);
      renderTable();
    } catch (_) { setStatus('error'); }
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
