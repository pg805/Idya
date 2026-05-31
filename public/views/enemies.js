// View: Enemies — info page listing enemies and their drops.
(function() {
  let data = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dropChance(field) {
    // Field is the roll array; non-zero entries / total entries = chance of any drop
    const nonZero = field.filter(v => v > 0).length;
    if (field.length === 0) return '—';
    const pct = Math.round((nonZero / field.length) * 100);
    return `${pct}%`;
  }

  async function mount(root) {
    setLayoutTitle('Enemies');
    root.innerHTML = `<div id="enemy-body"></div>`;
    if (!data) {
      const res = await fetch('/api/info/enemies');
      if (!res.ok) {
        document.getElementById('enemy-body').innerHTML = `<p class="enemy-empty">Could not load enemy data.</p>`;
        return;
      }
      data = await res.json();
    }
    render();
  }

  function render() {
    const body = document.getElementById('enemy-body');
    if (data.enemies.length === 0) {
      body.innerHTML = `<p class="enemy-empty">No enemies defined.</p>`;
      return;
    }

    body.innerHTML = data.enemies.map(e => `
      <section class="enemy-card">
        <header class="enemy-header">
          <h2 class="enemy-name">${esc(e.name)}</h2>
          <div class="enemy-stats">
            <span class="enemy-stat-chip">Lv ${e.level}</span>
            <span class="enemy-stat-chip">${e.health} HP</span>
          </div>
        </header>
        <table class="enemy-drops">
          <thead><tr>
            <th>Drop</th>
            <th>Type</th>
            <th>Chance</th>
            <th>Range</th>
            <th>Avg</th>
          </tr></thead>
          <tbody>
            ${e.drops.length === 0 ? `<tr><td colspan="5" class="enemy-no-drops">No drops</td></tr>` :
              e.drops.map(d => `
                <tr>
                  <td class="enemy-drop-name">${esc(d.name)}</td>
                  <td class="enemy-drop-type">${esc(d.type)}</td>
                  <td class="enemy-drop-chance">${dropChance(d.field)}</td>
                  <td class="enemy-drop-range">${d.min}–${d.max}</td>
                  <td class="enemy-drop-avg">${d.avg}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </section>
    `).join('');
  }

  function unmount() {}

  window.Views = window.Views ?? {};
  window.Views.enemies = { mount, unmount };
})();
