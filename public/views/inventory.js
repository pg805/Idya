// View: Inventory — everything the character owns.
(function() {
  let data = null;

  const TYPE_LABEL = { material: 'Materials', consumable: 'Consumables', valuable: 'Valuables', unlock: 'Unlocks' };
  const TYPE_ORDER = ['unlock', 'material', 'consumable', 'valuable'];

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function mount(root) {
    setLayoutTitle('Inventory');
    root.innerHTML = `<div id="inv-body"></div><div id="inv-toast"></div>`;
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
              ${w.equipped
                ? '<span class="inv-meta">equipped</span>'
                : `<button class="inv-equip-btn" onclick="Views.inventory.equip('${esc(w.id)}')">Equip</button>`}
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
          ${list.map(i => {
            let rhs;
            if (i.type === 'unlock' && typeof i.defeated_count === 'number') {
              rhs = `<span class="inv-tag">defeated ${i.defeated_count.toLocaleString()}×</span>`;
            } else if (i.type === 'unlock') {
              rhs = `<span class="inv-tag">permanent</span>`;
            } else {
              rhs = `×${i.quantity.toLocaleString()}`;
            }
            return `<div class="inv-row" title="${esc(i.description)}">
              <span class="inv-name">${esc(i.name)}</span>
              <span class="inv-qty">${rhs}</span>
            </div>`;
          }).join('')}
        </div>
      </section>`;
    }

    if (sectionsHtml === '') {
      sectionsHtml = `<p class="inv-empty">Your inventory is empty. Head to the forest!</p>`;
    }

    body.innerHTML = sectionsHtml;
  }

  async function equip(weaponId) {
    const res = await fetch('/api/character/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weapon_id: weaponId }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) {
      await mountLayout();
      await loadData();
    }
  }

  function toast(msg, ok) {
    const el = document.getElementById('inv-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    data = null;
  }

  window.Views = window.Views ?? {};
  window.Views.inventory = { mount, unmount, equip };
})();
