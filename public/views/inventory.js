// View: Inventory — everything the character owns.
(function() {
  let data = null;

  const TYPE_LABEL = { material: 'Materials', consumable: 'Consumables', valuable: 'Valuables' };
  const TYPE_ORDER = ['material', 'consumable', 'valuable'];

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function mount(root) {
    setLayoutTitle('Inventory');
    root.innerHTML = `<div id="inv-body"></div>`;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await loadData();
  }

  function layoutChangedHandler() { if (data) loadData(); }

  async function loadData() {
    const res = await fetch('/api/inventory');
    if (!res.ok) {
      document.getElementById('inv-body').innerHTML = `<p class="inv-empty">Could not load inventory.</p>`;
      return;
    }
    data = await res.json();
    render();
  }

  function render() {
    const body = document.getElementById('inv-body');

    const grouped = {};
    for (const t of TYPE_ORDER) grouped[t] = [];
    for (const i of data.items) (grouped[i.type] ?? grouped.material).push(i);

    let sectionsHtml = '';

    if (data.weapons.length > 0) {
      const sortedWeapons = [...data.weapons].sort(
        (a, b) => Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name)
      );
      sectionsHtml += `<section class="inv-section">
        <h2 class="inv-section-label">Weapons</h2>
        <div class="inv-list">
          ${sortedWeapons.map(w => `
            <div class="inv-row${w.equipped ? ' equipped' : ''}">
              <span class="inv-name">${esc(w.name)}${w.bonus_count > 0 ? ` <span class="inv-bonus">+${w.bonus_count}</span>` : ''}</span>
              ${w.equipped ? '<span class="inv-meta">equipped</span>' : ''}
            </div>
          `).join('')}
        </div>
      </section>`;
    }

    for (const t of TYPE_ORDER) {
      const list = grouped[t].filter(i => i.quantity > 0);
      if (list.length === 0) continue;
      list.sort((a, b) => a.name.localeCompare(b.name));
      sectionsHtml += `<section class="inv-section">
        <h2 class="inv-section-label">${TYPE_LABEL[t]}</h2>
        <div class="inv-list">
          ${list.map(i => `
            <div class="inv-row" title="${esc(i.description)}">
              <span class="inv-name">${esc(i.name)}</span>
              <span class="inv-qty">×${i.quantity.toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
      </section>`;
    }

    if (sectionsHtml === '') {
      sectionsHtml = `<p class="inv-empty">Your inventory is empty. Head to the forest!</p>`;
    }

    body.innerHTML = sectionsHtml;
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    data = null;
  }

  window.Views = window.Views ?? {};
  window.Views.inventory = { mount, unmount };
})();
