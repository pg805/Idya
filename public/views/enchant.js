// View: Enchant — apply enchantments to weapon actions.
(function() {
  let enchantData    = null;
  let enchantWeapon  = null;
  let enchantPending = null;

  const CAT_ORDER  = ['defend', 'defend_crit', 'attack', 'attack_crit', 'special', 'special_crit'];
  const CAT_LABELS = { defend: 'Defend', defend_crit: 'Defend Crit', attack: 'Attack', attack_crit: 'Attack Crit', special: 'Special', special_crit: 'Special Crit' };

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fieldSummary(field) {
    const min = Math.min(...field);
    const max = Math.max(...field);
    const avg = (field.reduce((a, b) => a + b, 0) / field.length).toFixed(1);
    return `${min}–${max} <span class="field-avg">avg ${avg}</span>`;
  }

  function safeId(name) { return name.replace(/[^a-zA-Z0-9]/g, '-'); }

  async function mount(root) {
    setLayoutTitle('Enchant Weapons');
    root.innerHTML = `
      <section id="enchant-tab">
        <div id="enchant-header">
          <select id="enchant-weapon-picker" onchange="Views.enchant.pickWeapon(this.value)"></select>
          <span id="enchant-materials"></span>
        </div>
        <div id="enchant-panel"></div>
      </section>
      <div id="craft-toast"></div>
    `;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await loadEnchant();
  }

  function layoutChangedHandler() { if (enchantData) loadEnchant(); }

  async function loadEnchant() {
    const res = await fetch('/api/enchant');
    if (!res.ok) {
      document.getElementById('enchant-panel').innerHTML = '<p class="empty">Could not load enchant data.</p>';
      return;
    }
    enchantData = await res.json();

    const picker = document.getElementById('enchant-weapon-picker');
    const matsEl = document.getElementById('enchant-materials');
    matsEl.textContent = `Thuvel ${enchantData.materials.thuvel} · Hiruos ${enchantData.materials.hiruos} · Nodol ${enchantData.materials.nodol}`;

    picker.innerHTML = '';
    if (enchantData.weapons.length === 0) {
      picker.innerHTML = '<option disabled>No weapons owned</option>';
      document.getElementById('enchant-panel').innerHTML = '<p class="empty">Craft a weapon first.</p>';
      return;
    }
    for (const w of enchantData.weapons) {
      const opt = document.createElement('option');
      opt.value = w.id;
      const bonus = w.bonus_count > 0 ? ` +${w.bonus_count}` : '';
      opt.textContent = `${w.name}${bonus}${w.equipped ? ' (equipped)' : ''} — ${w.enchants_used}/${w.enchant_slots} enchants`;
      picker.appendChild(opt);
    }
    const prevId = enchantWeapon?.id;
    enchantWeapon = enchantData.weapons.find(w => w.id === prevId) ?? enchantData.weapons[0];
    picker.value = enchantWeapon.id;
    enchantPending = null;
    renderEnchantPanel();
  }

  function pickWeapon(id) {
    enchantWeapon = enchantData?.weapons.find(w => w.id === id) ?? null;
    enchantPending = null;
    renderEnchantPanel();
  }

  function renderEnchantPanel() {
    const panel = document.getElementById('enchant-panel');
    if (!enchantWeapon) { panel.innerHTML = ''; return; }
    const w   = enchantWeapon;
    const lvl = enchantData.enchanter_level;

    if (lvl < 4) {
      panel.innerHTML = '<p class="upgrade-locked">Reach Enchanter level 4 to apply enchants.</p>';
      return;
    }

    const slotsFull = w.enchants_used >= w.enchant_slots;

    const budgetHtml = `
      <div class="upgrade-budget">
        <span class="budget-used">${w.enchants_used} / ${w.enchant_slots} enchants used</span>
        ${slotsFull ? '<span class="budget-cap">Slots full</span>' : ''}
      </div>`;

    let sectionsHtml = '';
    for (const cat of CAT_ORDER) {
      const actions = w.actions.filter(a => a.category === cat);
      if (actions.length === 0) continue;
      sectionsHtml += `<div class="upgrade-section"><p class="upg-cat-label">${CAT_LABELS[cat]}</p>`;
      for (const a of actions) sectionsHtml += renderEnchantRow(a, slotsFull);
      sectionsHtml += '</div>';
    }

    panel.innerHTML = budgetHtml + sectionsHtml;

    if (enchantPending) {
      const a = enchantWeapon.actions.find(x => x.name === enchantPending.actionName);
      const el = document.getElementById('enchant-editor');
      if (el && a) el.innerHTML = renderEnchantEditor(a);
    }
  }

  function renderEnchantRow(a, slotsFull) {
    if (!a.upgradeable) {
      return `<div class="upg-action dim">
        <span class="upg-name">${esc(a.name)}</span>
        <span class="cannot-upg">Cannot be enchanted</span>
      </div>`;
    }

    const editing   = enchantPending?.actionName === a.name;
    const enchanted = a.enchant;
    const statText  = a.type === 'field' ? fieldSummary(a.effective) : `${a.effective}`;

    let extraHtml = '';
    if (enchanted) {
      const deltaTxt = Array.isArray(enchanted.delta) ? `[${enchanted.delta.join(', ')}]` : `+${enchanted.delta}`;
      extraHtml = `<span class="enchant-tag">${esc(enchanted.category)} ${esc(enchanted.subtype)} ${enchanted.kind === 'major' ? '(major)' : ''} ${deltaTxt}</span>`;
    } else if (!slotsFull && !editing && !enchantPending) {
      extraHtml = `<button class="upg-btn" onclick="Views.enchant.startEnchant('${esc(a.name)}')">Enchant</button>`;
    }

    return `<div class="upg-action${enchanted ? ' dim' : ''}" id="ench-action-${safeId(a.name)}">
      <span class="upg-name">${esc(a.name)}</span>
      <span class="upg-stat">${statText}</span>
      ${extraHtml}
      ${editing ? '<div id="enchant-editor"></div>' : ''}
    </div>`;
  }

  function startEnchant(actionName) {
    const a = enchantWeapon.actions.find(x => x.name === actionName);
    if (!a) return;
    const perCell = 1;
    enchantPending = {
      actionName,
      kind: 'minor',
      category: 'physical',
      subtype: enchantData.subtypes.physical[0],
      delta: a.type === 'field' ? new Array(a.field_len).fill(0) : perCell,
    };
    renderEnchantPanel();
  }

  function cancelEnchant() {
    enchantPending = null;
    renderEnchantPanel();
  }

  function renderEnchantEditor(a) {
    const lvl = enchantData.enchanter_level;
    const p   = enchantPending;
    const perCell = p.kind === 'minor' ? 1 : 3;
    const targetDelta = a.type === 'field' ? perCell * a.field_len : perCell;

    const kinds = ['minor', 'major'].filter(k =>
      enchantData.categories.some(c => lvl >= enchantData.level_required[c][k])
    );
    const cats = enchantData.categories.filter(c => lvl >= enchantData.level_required[c][p.kind]);
    const subs = enchantData.subtypes[p.category];
    const cost = p.kind === 'minor' ? enchantData.minor_cost : enchantData.major_cost;
    const canAfford = Object.entries(cost).every(([m, q]) => (enchantData.materials[m] ?? 0) >= q);
    const costStr = Object.entries(cost).map(([m, q]) => `${q} ${m}`).join(', ');

    let entriesHtml = '';
    let remHtml     = '';
    let sumOk       = true;
    if (a.type === 'field') {
      const spent = p.delta.reduce((s, v) => s + v, 0);
      const rem   = targetDelta - spent;
      sumOk = rem === 0;
      for (let i = 0; i < p.delta.length; i++) {
        const effective = a.effective[i] + p.delta[i];
        const canMinus  = p.delta[i] > 0;
        const canPlus   = rem > 0;
        entriesHtml += `<div class="fe-entry">
          <span class="fe-val">${effective}</span>
          <div class="fe-btns">
            <button onclick="Views.enchant.adjDelta(${i}, -1)" ${canMinus ? '' : 'disabled'}>−</button>
            <button onclick="Views.enchant.adjDelta(${i},  1)" ${canPlus  ? '' : 'disabled'}>+</button>
          </div>
        </div>`;
      }
      remHtml = `<p class="fe-budget">${rem} point${rem !== 1 ? 's' : ''} to place</p>`;
    } else {
      entriesHtml = `<div class="fe-entry"><span class="fe-val">${a.effective + p.delta}</span></div>`;
      remHtml = `<p class="fe-budget">+${perCell} to value</p>`;
    }

    return `<div class="field-editor">
      <div class="enchant-dropdowns">
        <label>Kind:</label>
        <select onchange="Views.enchant.setKind(this.value)">
          ${kinds.map(k => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
        <label>Category:</label>
        <select onchange="Views.enchant.setCategory(this.value)">
          ${cats.map(c => `<option value="${c}" ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <label>Subtype:</label>
        <select onchange="Views.enchant.setSubtype(this.value)">
          ${subs.map(s => `<option value="${s}" ${s === p.subtype ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      ${remHtml}
      <div class="fe-entries">${entriesHtml}</div>
      <p class="enchant-cost ${canAfford ? '' : 'cant-afford'}">Cost: ${costStr}</p>
      <div class="fe-controls">
        <button onclick="Views.enchant.cancel()">Cancel</button>
        <button class="upg-btn" onclick="Views.enchant.confirm()" ${(!canAfford || !sumOk) ? 'disabled' : ''}>Confirm</button>
      </div>
    </div>`;
  }

  function setKind(k) {
    if (!enchantPending) return;
    enchantPending.kind = k;
    const a = enchantWeapon.actions.find(x => x.name === enchantPending.actionName);
    const perCell = k === 'minor' ? 1 : 3;
    if (a.type === 'field') {
      enchantPending.delta = new Array(a.field_len).fill(0);
    } else {
      enchantPending.delta = perCell;
    }
    const lvl = enchantData.enchanter_level;
    if (lvl < enchantData.level_required[enchantPending.category][k]) {
      enchantPending.category = enchantData.categories.find(c => lvl >= enchantData.level_required[c][k]) ?? enchantPending.category;
      enchantPending.subtype  = enchantData.subtypes[enchantPending.category][0];
    }
    renderEnchantPanel();
  }

  function setCategory(c) {
    if (!enchantPending) return;
    enchantPending.category = c;
    enchantPending.subtype  = enchantData.subtypes[c][0];
    renderEnchantPanel();
  }

  function setSubtype(s) {
    if (!enchantPending) return;
    enchantPending.subtype = s;
    renderEnchantPanel();
  }

  function adjDelta(i, dir) {
    if (!enchantPending || !Array.isArray(enchantPending.delta)) return;
    const a = enchantWeapon.actions.find(x => x.name === enchantPending.actionName);
    const perCell = enchantPending.kind === 'minor' ? 1 : 3;
    const target = perCell * a.field_len;
    const spent  = enchantPending.delta.reduce((s, v) => s + v, 0);
    if (dir > 0 && spent >= target) return;
    if (dir < 0 && enchantPending.delta[i] <= 0) return;
    enchantPending.delta[i] += dir;
    renderEnchantPanel();
  }

  async function confirm() {
    if (!enchantPending || !enchantWeapon) return;
    const res = await fetch(`/api/enchant/${enchantWeapon.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: enchantPending.actionName,
        kind: enchantPending.kind,
        category: enchantPending.category,
        subtype: enchantPending.subtype,
        delta: enchantPending.delta,
      }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) {
      enchantPending = null;
      await mountLayout();
    }
  }

  function toast(msg, ok) {
    const el = document.getElementById('craft-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    enchantData = null; enchantWeapon = null; enchantPending = null;
  }

  window.Views = window.Views ?? {};
  window.Views.enchant = {
    mount, unmount,
    pickWeapon, startEnchant, cancel: cancelEnchant, confirm,
    setKind, setCategory, setSubtype, adjDelta,
  };
  window.showToast = (msg) => toast(msg, true);
})();
