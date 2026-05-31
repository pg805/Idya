// View: Weapon Stats — reference table of all weapons.
(function() {
  let weapons = [];
  let selected = null;
  let activeProfs = new Set(['Lumberjack', 'Blacksmith', 'Enchanter']);

  const PROF_LABELS = ['Lumberjack', 'Blacksmith', 'Enchanter'];

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function matchesFilter(w) {
    if (w.professions.length === 0) return true; // weapons with no profession (e.g. branch) always show
    return w.professions.some(p => activeProfs.has(p));
  }

  async function mount(root) {
    setLayoutTitle('Weapons');
    root.innerHTML = `
      <div class="ws-body">
        <aside class="ws-sidebar">
          <h2>Weapons</h2>
          <div class="ws-filter" id="ws-filter"></div>
          <div class="ws-list" id="ws-list"></div>
        </aside>
        <main class="ws-detail" id="ws-detail">
          <p class="ws-hint">Select a weapon to view its stats.</p>
        </main>
      </div>
    `;

    renderFilter();

    const res = await fetch('/api/weapons');
    const data = await res.json();
    weapons = data.weapons.filter(w => w.key !== 'honor');
    renderList();
  }

  function renderFilter() {
    const el = document.getElementById('ws-filter');
    el.innerHTML = PROF_LABELS.map(p => `
      <label class="ws-filter-check">
        <input type="checkbox" ${activeProfs.has(p) ? 'checked' : ''} onchange="Views.weapons.toggleProf('${p}')">
        ${p}
      </label>
    `).join('');
  }

  function renderList() {
    const list = document.getElementById('ws-list');
    list.innerHTML = '';
    const visible = weapons.filter(matchesFilter);
    if (visible.length === 0) {
      list.innerHTML = '<p class="ws-empty">No weapons match the filter.</p>';
      return;
    }
    for (const w of visible) {
      const btn = document.createElement('button');
      btn.className = 'ws-weapon-btn';
      btn.dataset.key = w.key;
      if (selected && selected.key === w.key) btn.classList.add('active');
      btn.innerHTML = `<span class="ws-wname">${esc(w.name)}</span><span class="ws-wlevel">Lv ${w.level}</span>`;
      btn.onclick = () => selectWeapon(w.key);
      list.appendChild(btn);
    }
  }

  function toggleProf(p) {
    if (activeProfs.has(p)) activeProfs.delete(p);
    else activeProfs.add(p);
    renderList();
  }

  function selectWeapon(key) {
    selected = weapons.find(w => w.key === key);
    if (!selected) return;

    document.querySelectorAll('.ws-weapon-btn').forEach(b => b.classList.toggle('active', b.dataset.key === key));

    const w = selected;
    const resourceLine = w.resource ? `${w.resource.name} ${w.resource.max}` : '—';

    let rows = '';
    for (const set of w.sets) {
      for (let i = 0; i < set.actions.length; i++) {
        const a         = set.actions[i];
        const stat      = a.field ? `[${a.field.join(', ')}]` : `${a.value ?? 0}`;
        const costLabel = a.cost > 0 ? `−${a.cost}` : a.cost < 0 ? `+${Math.abs(a.cost)}` : '0';
        const mode      = a.field ? (a.aimed ? 'Aimed' : 'Reactive') : '—';
        const range     = a.range != null ? `${a.range}` : '—';
        const setCell   = i === 0
          ? `<td class="ws-td-set" rowspan="${set.actions.length}">${esc(set.label)}</td>`
          : '';
        rows += `<tr>
          ${setCell}
          <td class="ws-td-name">${esc(a.name)}</td>
          <td class="ws-td-type">${esc(a.type_name)}</td>
          <td class="ws-td-stat">${esc(stat)}</td>
          <td class="ws-td-cost">${costLabel}</td>
          <td class="ws-td-mode">${mode}</td>
          <td class="ws-td-range">${range}</td>
          <td class="ws-td-dmg">${esc(a.damage_subtype)}</td>
        </tr>`;
      }
    }

    document.getElementById('ws-detail').innerHTML = `
      <div class="ws-weapon-header">
        <h2>${esc(w.name)}</h2>
        <p class="ws-weapon-meta">Lv ${w.level} &nbsp;·&nbsp; ${w.hp} HP &nbsp;·&nbsp; ${resourceLine}</p>
        ${w.professions.length ? `<p class="ws-weapon-prof">Crafted by: ${w.professions.join(', ')}</p>` : ''}
        <p class="ws-wdesc">${esc(w.description)}</p>
      </div>
      <table class="ws-action-table">
        <thead><tr>
          <th>Set</th><th>Name</th><th>Type</th><th>Field / Value</th>
          <th>Cost</th><th>Mode</th><th>Range</th><th>Damage</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function unmount() {
    weapons = [];
    selected = null;
  }

  window.Views = window.Views ?? {};
  window.Views.weapons = { mount, unmount, toggleProf };
})();
