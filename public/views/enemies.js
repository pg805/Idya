// View: Enemies — sidebar + detail; full drop info per enemy.
(function() {
  let enemies = [];
  let selected = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function mount(root) {
    setLayoutTitle('Enemies');
    root.innerHTML = `
      <div class="en-body">
        <aside class="en-sidebar">
          <h2>Enemies</h2>
          <div class="en-list" id="en-list"></div>
        </aside>
        <main class="en-detail" id="en-detail">
          <p class="en-hint">Select an enemy to view drops.</p>
        </main>
      </div>
    `;

    const res = await fetch('/api/info/enemies');
    if (!res.ok) {
      document.getElementById('en-detail').innerHTML = `<p class="en-hint">Could not load enemy data.</p>`;
      return;
    }
    const data = await res.json();
    enemies = data.enemies;

    const list = document.getElementById('en-list');
    list.innerHTML = '';
    for (const e of enemies) {
      const btn = document.createElement('button');
      btn.className = 'en-btn';
      btn.dataset.key = e.key;
      btn.innerHTML = `<span class="en-bname">${esc(e.name)}</span><span class="en-blevel">Lv ${e.level}</span>`;
      btn.onclick = () => select(e.key);
      list.appendChild(btn);
    }
  }

  function select(key) {
    selected = enemies.find(e => e.key === key);
    if (!selected) return;
    document.querySelectorAll('.en-btn').forEach(b => b.classList.toggle('active', b.dataset.key === key));

    const e = selected;
    const dropRows = e.drops.length === 0
      ? `<tr><td colspan="5" class="en-no-drops">No drops</td></tr>`
      : e.drops.map(d => `
          <tr>
            <td class="en-drop-name">${esc(d.name)}</td>
            <td class="en-drop-type">${esc(d.type)}</td>
            <td class="en-drop-field">[${d.field.join(', ')}]</td>
            <td class="en-drop-range">${d.min}–${d.max}</td>
            <td class="en-drop-avg">${d.avg}</td>
          </tr>
        `).join('');

    document.getElementById('en-detail').innerHTML = `
      <div class="en-header">
        <h2>${esc(e.name)}</h2>
        <p class="en-meta">Lv ${e.level} &nbsp;·&nbsp; ${e.health} HP</p>
      </div>
      <table class="en-drops">
        <thead><tr>
          <th>Drop</th><th>Type</th><th>Field (roll table)</th><th>Range</th><th>Avg</th>
        </tr></thead>
        <tbody>${dropRows}</tbody>
      </table>
      <p class="en-note">Each turn drops are rolled by picking a random value from the field array. The roll = items dropped that turn.</p>
    `;
  }

  function unmount() {
    enemies = [];
    selected = null;
  }

  window.Views = window.Views ?? {};
  window.Views.enemies = { mount, unmount };
})();
