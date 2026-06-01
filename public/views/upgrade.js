// View: Upgrade — weapon stat upgrades by profession.
(function() {
  let upgradeData    = null;
  let selectedWeapon = null;
  let pendingDelta   = null;

  const CAT_ORDER  = ['defend', 'defend_crit', 'attack', 'attack_crit', 'special', 'special_crit'];
  const CAT_LABELS = { defend: 'Defend', defend_crit: 'Defend Crit', attack: 'Attack', attack_crit: 'Attack Crit', special: 'Special', special_crit: 'Special Crit' };

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fieldSummary(field) {
    return `<span class="field-rolls">[${field.join(', ')}]</span>`;
  }

  function safeId(name) { return name.replace(/[^a-zA-Z0-9]/g, '-'); }

  async function mount(root) {
    setLayoutTitle('Upgrade Weapons');
    root.innerHTML = `
      <section id="upgrade-tab">
        <div id="upgrade-header">
          <select id="weapon-picker" onchange="Views.upgrade.pickWeapon(this.value)"></select>
        </div>
        <div id="upgrade-panel"></div>
      </section>
      <div id="craft-toast"></div>
    `;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await loadUpgrade();
  }

  function layoutChangedHandler() { if (upgradeData) loadUpgrade(); }

  async function loadUpgrade() {
    const prevId = selectedWeapon?.id;
    const res = await fetch('/api/upgrade');
    if (!res.ok) { document.getElementById('upgrade-panel').innerHTML = '<p class="empty">Could not load weapons.</p>'; return; }
    upgradeData = await res.json();

    const picker = document.getElementById('weapon-picker');
    picker.innerHTML = '';
    if (upgradeData.weapons.length === 0) {
      picker.innerHTML = '<option disabled>No weapons owned</option>';
      document.getElementById('upgrade-panel').innerHTML = '<p class="empty">Craft a weapon first.</p>';
      return;
    }
    for (const w of upgradeData.weapons) {
      const opt = document.createElement('option');
      opt.value = w.id;
      const bonus = w.bonus_count > 0 ? ` +${w.bonus_count}` : '';
      opt.textContent = w.name + bonus + (w.equipped ? ' (equipped)' : '');
      picker.appendChild(opt);
    }
    selectedWeapon = upgradeData.weapons.find(w => w.id === prevId) ?? upgradeData.weapons[0];
    picker.value = selectedWeapon.id;
    renderUpgradePanel();
  }

  function pickWeapon(id) {
    selectedWeapon = upgradeData?.weapons.find(w => w.id === id) ?? null;
    pendingDelta = null;
    renderUpgradePanel();
  }

  function renderUpgradePanel() {
    const panel = document.getElementById('upgrade-panel');
    if (!selectedWeapon) { panel.innerHTML = ''; return; }
    const w = selectedWeapon;

    if (w.weapon_cap === 0) {
      panel.innerHTML = '<p class="upgrade-locked">Reach level 4 in a profession to unlock weapon upgrades.</p>';
      return;
    }

    const atCap    = w.weapon_total >= w.weapon_cap;
    const nextProf = w.upgrade_professions.find(p => !p.at_cap);
    const nextCost = nextProf?.next_cost ?? null;

    const budgetHtml = `
      <div class="upgrade-budget">
        <span class="budget-used">${w.weapon_total} / ${w.weapon_cap} upgrades used</span>
        ${atCap
          ? '<span class="budget-cap">Budget full — level up to expand</span>'
          : nextCost ? `<span class="budget-next">Next: <b>${nextCost.quantity}</b> ${esc(nextCost.material_name ?? nextCost.material)}</span>` : ''}
      </div>`;

    let sectionsHtml = '';
    for (const cat of CAT_ORDER) {
      const actions = w.actions.filter(a => a.category === cat);
      if (actions.length === 0) continue;
      sectionsHtml += `<div class="upgrade-section"><p class="upg-cat-label">${CAT_LABELS[cat]}</p>`;
      for (const a of actions) sectionsHtml += renderActionRow(a, atCap);
      sectionsHtml += '</div>';
    }

    panel.innerHTML = budgetHtml + sectionsHtml;
    if (pendingDelta) renderFieldEditor();
  }

  function renderActionRow(a, atCap) {
    if (!a.upgradeable) {
      return `<div class="upg-action dim">
        <span class="upg-name">${esc(a.name)}</span>
        <span class="cannot-upg">Cannot be upgraded</span>
      </div>`;
    }

    const editingThis = pendingDelta?.actionName === a.name;

    if (a.type === 'value') {
      const totalBonus = a.base_bonus + a.player_bonus;
      const bonusTag   = totalBonus > 0 ? `<span class="bonus-tag">+${totalBonus}</span>` : '';
      const btn = (!atCap && !pendingDelta)
        ? `<button class="upg-btn" onclick="Views.upgrade.upgradeValue('${esc(a.name)}')">+1</button>` : '';
      return `<div class="upg-action">
        <span class="upg-name">${esc(a.name)}</span>
        <span class="upg-stat">${a.effective}${bonusTag}</span>
        ${btn}
      </div>`;
    }

    const playerTotal = a.player_bonus.reduce((s, v) => s + v, 0);
    const baseTotal   = a.base_bonus.reduce((s, v) => s + v, 0);
    const totalBonus  = playerTotal + baseTotal;
    const bonusTag    = totalBonus > 0 ? `<span class="bonus-tag">+${totalBonus}</span>` : '';
    const statText    = fieldSummary(a.effective);
    const btn = (!atCap && !pendingDelta && !editingThis)
      ? `<button class="upg-btn" onclick="Views.upgrade.startFieldEdit('${esc(a.name)}', ${a.field_len})">Upgrade</button>` : '';

    return `<div class="upg-action" id="upg-action-${safeId(a.name)}">
      <span class="upg-name">${esc(a.name)}</span>
      <span class="upg-stat">${statText}${bonusTag}</span>
      ${btn}
      ${editingThis ? '<div id="field-editor"></div>' : ''}
    </div>`;
  }

  function startFieldEdit(actionName, fieldLen) {
    pendingDelta = { actionName, delta: new Array(fieldLen).fill(0) };
    renderUpgradePanel();
  }

  function renderFieldEditor() {
    const el = document.getElementById('field-editor');
    if (!el || !pendingDelta) return;

    const a       = selectedWeapon.actions.find(x => x.name === pendingDelta.actionName);
    const spent   = pendingDelta.delta.reduce((s, v) => s + v, 0);
    const rem     = pendingDelta.delta.length - spent;

    let entriesHtml = '';
    for (let i = 0; i < pendingDelta.delta.length; i++) {
      const effective = a.effective[i] + pendingDelta.delta[i];
      const canMinus  = pendingDelta.delta[i] > 0;
      const canPlus   = rem > 0;
      entriesHtml += `<div class="fe-entry">
        <span class="fe-val">${effective}</span>
        <div class="fe-btns">
          <button onclick="Views.upgrade.adjustDelta(${i}, -1)" ${canMinus ? '' : 'disabled'}>−</button>
          <button onclick="Views.upgrade.adjustDelta(${i},  1)" ${canPlus  ? '' : 'disabled'}>+</button>
        </div>
      </div>`;
    }

    el.innerHTML = `<div class="field-editor">
      <p class="fe-budget">${rem} point${rem !== 1 ? 's' : ''} to place</p>
      <div class="fe-entries">${entriesHtml}</div>
      <div class="fe-controls">
        <button onclick="Views.upgrade.cancelFieldEdit()">Cancel</button>
        <button class="upg-btn" onclick="Views.upgrade.confirmFieldEdit()" ${rem !== 0 ? 'disabled' : ''}>Confirm</button>
      </div>
    </div>`;
  }

  function adjustDelta(i, dir) {
    if (!pendingDelta) return;
    const spent = pendingDelta.delta.reduce((s, v) => s + v, 0);
    const rem   = pendingDelta.delta.length - spent;
    if (dir > 0 && rem === 0) return;
    if (dir < 0 && pendingDelta.delta[i] === 0) return;
    pendingDelta.delta[i] += dir;
    renderFieldEditor();
  }

  function cancelFieldEdit() {
    pendingDelta = null;
    renderUpgradePanel();
  }

  async function confirmFieldEdit() {
    if (!pendingDelta || !selectedWeapon) return;
    const res = await fetch(`/api/upgrade/${selectedWeapon.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: pendingDelta.actionName, delta: pendingDelta.delta }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { pendingDelta = null; await mountLayout(); }
  }

  async function upgradeValue(actionName) {
    if (!selectedWeapon) return;
    const res = await fetch(`/api/upgrade/${selectedWeapon.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: actionName, delta: 1 }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) await mountLayout();
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
    upgradeData = null; selectedWeapon = null; pendingDelta = null;
  }

  window.Views = window.Views ?? {};
  window.Views.upgrade = {
    mount, unmount,
    pickWeapon, upgradeValue, startFieldEdit, adjustDelta, cancelFieldEdit, confirmFieldEdit,
  };
  window.showToast = (msg) => toast(msg, true);
})();
