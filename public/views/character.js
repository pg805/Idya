// View: Character — sprite, HP, bio, equipped weapon, owned weapons.
(function() {
  let data = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function mount(root) {
    setLayoutTitle('Character');
    root.innerHTML = `<div id="char-body"></div><div id="char-toast"></div>`;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await loadData();
  }

  function layoutChangedHandler() { if (data) loadData(); }

  async function loadData() {
    const res = await fetch('/api/character');
    if (!res.ok) {
      document.getElementById('char-body').innerHTML = `<p class="char-empty">Could not load character.</p>`;
      return;
    }
    data = await res.json();
    render();
  }

  function render() {
    const body = document.getElementById('char-body');
    const c = data;
    const spriteUrl = c.sprite_token ? `${c.sprite_cdn}/${c.sprite_token}.png` : null;
    const hpPct = c.max_health > 0 ? (c.health / c.max_health) * 100 : 0;

    const weaponRows = c.weapons.map(w => `
      <tr class="${w.equipped ? 'equipped' : ''}">
        <td class="char-w-name">${esc(w.name)}${w.bonus_count > 0 ? ` <span class="char-w-bonus">+${w.bonus_count}</span>` : ''}</td>
        <td class="char-w-meta">Lv ${w.level} · ${w.hp} HP</td>
        <td class="char-w-action">
          ${w.equipped
            ? '<span class="char-w-tag">Equipped</span>'
            : `<button class="char-equip-btn" onclick="Views.character.equip('${esc(w.weapon_key)}')">Equip</button>`}
        </td>
      </tr>
    `).join('');

    body.innerHTML = `
      <section class="char-hero">
        <div class="char-sprite-box">
          ${spriteUrl ? `<img src="${spriteUrl}" alt="${esc(c.name)}">` : ''}
        </div>
        <div class="char-summary">
          <h2 class="char-name">${esc(c.name)}</h2>
          ${c.nationality ? `<p class="char-nationality">${esc(c.nationality)}</p>` : ''}
          ${c.bio ? `<p class="char-bio">${esc(c.bio)}</p>` : '<p class="char-bio-empty">No bio set.</p>'}
        </div>
      </section>

      <section class="char-section">
        <h3 class="char-section-label">Vitals</h3>
        <div class="char-vital-row">
          <span class="char-vital-name">HP</span>
          <div class="char-hp-bar-bg"><div class="char-hp-bar" style="width:${hpPct}%"></div></div>
          <span class="char-vital-val">${c.health} / ${c.max_health}</span>
        </div>
      </section>

      <section class="char-section">
        <h3 class="char-section-label">Weapons</h3>
        ${c.weapons.length === 0
          ? '<p class="char-empty">No weapons owned. Craft one at the bench.</p>'
          : `<table class="char-weapon-table"><tbody>${weaponRows}</tbody></table>`}
      </section>
    `;
  }

  async function equip(weaponKey) {
    const res = await fetch('/api/character/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weapon_key: weaponKey }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) await mountLayout();
  }

  function toast(msg, ok) {
    const el = document.getElementById('char-toast');
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
  window.Views.character = { mount, unmount, equip };
})();
