// View: Dev Battle Stats — aggregated live battle data with enemy/weapon/version filters.
// Dev-only; the server-side endpoint also gates with isDev so a non-dev hitting the route
// gets 403 rather than rendering an empty page.
(function() {
  // null means "no filter applied" — all values pass. A Set with selected
  // values means only those pass. We deliberately don't pre-populate the
  // sets from the available list so the UI default matches the "no query
  // params" behavior of the server.
  let available = { enemies: [], weapons: [], versions: [] };
  let selected  = { enemies: null, weapons: null, versions: null };
  let groupBy   = 'enemy'; // 'enemy' | 'weapon'
  let lastData  = null;
  let versionDefaultsApplied = false;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function pctFmt(n) { return (n * 100).toFixed(1) + '%'; }

  function queryString() {
    const parts = [];
    if (selected.enemies)  parts.push('enemies='  + encodeURIComponent([...selected.enemies].join(',')));
    if (selected.weapons)  parts.push('weapons='  + encodeURIComponent([...selected.weapons].join(',')));
    if (selected.versions) parts.push('versions=' + encodeURIComponent([...selected.versions].join(',')));
    return parts.length > 0 ? '?' + parts.join('&') : '';
  }

  async function refetch() {
    const res = await fetch('/api/dev/stats' + queryString());
    if (!res.ok) {
      document.getElementById('ds-root').innerHTML =
        `<p class="ds-error">Could not load stats (${res.status}).</p>`;
      return;
    }
    lastData = await res.json();
    available = lastData.available;
    // pre-0.2.0 is noisy legacy data — opt out on first load, but only once
    // so a dev who manually re-enables it doesn't get it stripped on refetch.
    if (!versionDefaultsApplied) {
      versionDefaultsApplied = true;
      if (available.versions.includes('pre-0.2.0') && available.versions.length > 1) {
        selected.versions = new Set(available.versions.filter(v => v !== 'pre-0.2.0'));
        await refetch();
        return;
      }
    }
    render();
  }

  function toggleInSet(key, value) {
    // First click on a chip group: start filtering with everything pre-selected
    // EXCEPT the one being toggled off. Otherwise toggle membership normally.
    if (selected[key] === null) {
      selected[key] = new Set(available[key].map(item => typeof item === 'string' ? item : item.key));
    }
    if (selected[key].has(value)) selected[key].delete(value);
    else                          selected[key].add(value);
    // If the user re-selected everything, drop back to "no filter" so the URL
    // and request stay clean.
    const all = available[key].map(item => typeof item === 'string' ? item : item.key);
    if (all.every(v => selected[key].has(v))) selected[key] = null;
    refetch();
  }

  function isActive(key, value) {
    if (selected[key] === null) return true;
    return selected[key].has(value);
  }

  function histogramHtml(title, items) {
    if (items.length === 0) return `<div class="ds-histo"><h3>${title}</h3><p class="ds-empty">No data.</p></div>`;
    const max = Math.max(...items.map(i => i.count));
    const bars = items.map(i => {
      const pct = max > 0 ? (i.count / max) * 100 : 0;
      return `
        <div class="ds-bar-row">
          <span class="ds-bar-label">${esc(i.name)}</span>
          <div class="ds-bar-track"><div class="ds-bar-fill" style="width:${pct}%"></div></div>
          <span class="ds-bar-count">${i.count}</span>
        </div>`;
    }).join('');
    return `<div class="ds-histo"><h3>${title}</h3>${bars}</div>`;
  }

  function chipsHtml(key, items, labelOf) {
    return items.map(item => {
      const value = typeof item === 'string' ? item : item.key;
      const label = labelOf(item);
      const cls = isActive(key, value) ? 'ds-chip ds-chip-on' : 'ds-chip';
      return `<button class="${cls}" data-filter="${key}" data-value="${esc(value)}">${esc(label)}</button>`;
    }).join('');
  }

  function simHtml(sim, version) {
    if (!sim || !Array.isArray(sim.matchups) || sim.matchups.length === 0) return '';
    // Pivot the flat matchup list into a weapon × enemy grid. Each cell shows
    // win% (the most discriminating metric per CLAUDE.md), with enemies sorted
    // by HP so harder fights end up on the right.
    const byWeapon = new Map();
    const enemyKeys = [];
    const enemyMeta = new Map();
    for (const m of sim.matchups) {
      if (!byWeapon.has(m.weapon_key)) byWeapon.set(m.weapon_key, { name: m.weapon_name, level: m.weapon_level, cells: new Map() });
      byWeapon.get(m.weapon_key).cells.set(m.enemy_key, m);
      if (!enemyMeta.has(m.enemy_key)) { enemyMeta.set(m.enemy_key, { name: m.enemy_name, hp: m.enemy_hp }); enemyKeys.push(m.enemy_key); }
    }
    enemyKeys.sort((a, b) => enemyMeta.get(a).hp - enemyMeta.get(b).hp);

    const head = `<tr><th>Weapon</th>${enemyKeys.map(k => `<th>${esc(enemyMeta.get(k).name)}<br><span class="ds-sim-hp">${enemyMeta.get(k).hp} HP</span></th>`).join('')}</tr>`;
    const rows = [...byWeapon.entries()]
      .sort((a, b) => (a[1].level - b[1].level) || a[1].name.localeCompare(b[1].name))
      .map(([_wk, info]) => {
        const cells = enemyKeys.map(ek => {
          const cell = info.cells.get(ek);
          if (!cell) return `<td class="ds-sim-cell ds-sim-empty">—</td>`;
          const winPct = (cell.winRate * 100).toFixed(0);
          const cls = cell.winRate >= 0.7 ? 'ds-sim-good' : cell.winRate >= 0.4 ? 'ds-sim-mid' : 'ds-sim-bad';
          return `<td class="ds-sim-cell ${cls}" title="HP left ${cell.avgHpLeft.toFixed(1)} · ${cell.avgRoundsWin.toFixed(1)} rd to win · DPR ${cell.avgDmgToEnemy.toFixed(2)}">${winPct}%</td>`;
        }).join('');
        return `<tr><td class="ds-sim-weapon">${esc(info.name)}<br><span class="ds-sim-lvl">L${info.level}</span></td>${cells}</tr>`;
      }).join('');

    return `
      <section class="ds-sim">
        <header>
          <h3>Sim — ${esc(version)}</h3>
          <span class="ds-sim-meta">${sim.n_per_matchup} battles/matchup · generated ${new Date(sim.generated_at).toLocaleDateString()}</span>
        </header>
        <p class="ds-sim-note">Win% by weapon (rows) vs enemy (columns, sorted by HP). Hover cells for HP-left / rounds / DPR.</p>
        <div class="ds-sim-wrap"><table class="ds-sim-table">${head}${rows}</table></div>
      </section>`;
  }

  function groupsHtml(groups, breakdownLabel) {
    if (groups.length === 0) return `<p class="ds-empty">No battles match these filters.</p>`;
    return groups.map(g => {
      const rows = g.breakdown.map(b => `
        <tr>
          <td>${esc(b.name)}</td>
          <td class="ds-num">${b.total}</td>
          <td class="ds-num">${b.wins}</td>
          <td class="ds-num">${b.losses}</td>
          <td class="ds-num">${pctFmt(b.win_rate)}</td>
          <td class="ds-num">${b.avg_korel.toFixed(1)}</td>
        </tr>`).join('');
      return `
        <section class="ds-enemy-card">
          <header>
            <h3>${esc(g.name)}</h3>
            <span class="ds-enemy-meta">${g.total} battles · ${g.wins}W ${g.losses}L · ${pctFmt(g.win_rate)} win · ${g.avg_korel.toFixed(1)} avg korel</span>
          </header>
          <table class="ds-table">
            <thead><tr><th>${breakdownLabel}</th><th>Battles</th><th>Wins</th><th>Losses</th><th>Win %</th><th>Avg Korel</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    }).join('');
  }

  function render() {
    const root = document.getElementById('ds-root');
    if (!lastData) { root.innerHTML = `<p class="ds-empty">Loading…</p>`; return; }

    const enemyChips   = chipsHtml('enemies',  available.enemies,  e => e.name);
    const weaponChips  = chipsHtml('weapons',  available.weapons,  w => w.name);
    const versionChips = chipsHtml('versions', available.versions, v => v);

    root.innerHTML = `
      <div class="ds-histos">
        ${histogramHtml('Enemy popularity', lastData.histograms.enemies)}
        ${histogramHtml('Weapon popularity', lastData.histograms.weapons)}
      </div>
      <div class="ds-filters">
        <div class="ds-filter-row"><span class="ds-filter-label">Versions</span><div class="ds-chips">${versionChips}</div></div>
        <div class="ds-filter-row"><span class="ds-filter-label">Enemies</span><div class="ds-chips">${enemyChips}</div></div>
        <div class="ds-filter-row"><span class="ds-filter-label">Weapons</span><div class="ds-chips">${weaponChips}</div></div>
      </div>
      <div class="ds-group-bar">
        <span class="ds-filter-label">Group by</span>
        <button class="ds-toggle ${groupBy === 'enemy'  ? 'ds-toggle-on' : ''}" data-group="enemy">Enemy</button>
        <button class="ds-toggle ${groupBy === 'weapon' ? 'ds-toggle-on' : ''}" data-group="weapon">Weapon</button>
        <span class="ds-total">${lastData.total_battles} battles in current selection.</span>
      </div>
      <div class="ds-enemies">${
        groupBy === 'enemy'
          ? groupsHtml(lastData.per_enemy,  'Weapon')
          : groupsHtml(lastData.per_weapon, 'Enemy')
      }</div>
      ${simHtml(lastData.sim, lastData.app_version)}
    `;

    root.querySelectorAll('.ds-chip').forEach(btn => {
      btn.addEventListener('click', () => toggleInSet(btn.dataset.filter, btn.dataset.value));
    });
    root.querySelectorAll('.ds-toggle').forEach(btn => {
      btn.addEventListener('click', () => { groupBy = btn.dataset.group; render(); });
    });
  }

  async function mount(rootEl) {
    setLayoutTitle('Dev — Battle Stats');
    rootEl.innerHTML = `<div id="ds-root" class="ds-page"><p class="ds-empty">Loading…</p></div>`;
    await refetch();
  }

  function unmount() {
    available = { enemies: [], weapons: [], versions: [] };
    selected  = { enemies: null, weapons: null, versions: null };
    groupBy   = 'enemy';
    versionDefaultsApplied = false;
    lastData  = null;
  }

  window.Views = window.Views ?? {};
  window.Views.dev_stats = { mount, unmount };
})();
