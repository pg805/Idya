// View: Upgrade — weapon upgrades. Each upgrade hands you an EV pool + an
// automatic HP gain. You pick an ability, pour points into it (repeat across
// abilities until the pool is spent), then commit the whole upgrade at once.
(function() {
  let upgradeData    = null;
  let selectedWeapon = null;
  let pending        = null;  // { ev, hp, deltas: { [name]: number[] | number } }
  let selected       = null;  // ability currently receiving points

  const CAT_ORDER  = ['defend', 'defend_crit', 'attack', 'attack_crit', 'special', 'special_crit'];
  const CAT_LABELS = { defend: 'Defend', defend_crit: 'Defend Crit', attack: 'Attack', attack_crit: 'Attack Crit', special: 'Special', special_crit: 'Special Crit' };

  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fieldSummary(field) { return `<span class="field-rolls">[${field.join(', ')}]</span>`; }

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
    pending = null; selected = null;
    renderUpgradePanel();
  }

  function poolUsed() {
    if (!pending) return 0;
    let u = 0;
    for (const d of Object.values(pending.deltas)) u += Array.isArray(d) ? d.reduce((s, v) => s + v, 0) : d;
    return u;
  }
  function poolLeft() { return pending ? pending.ev - poolUsed() : 0; }

  function renderUpgradePanel() {
    const panel = document.getElementById('upgrade-panel');
    if (!selectedWeapon) { panel.innerHTML = ''; return; }
    const w = selectedWeapon;

    if (w.upgrade_cap === 0) {
      panel.innerHTML = '<p class="upgrade-locked">Reach level 2 in a profession to unlock weapon upgrades.</p>';
      return;
    }

    const curHp = w.base_hp + w.hp_bonus;
    const metaHtml = `<div class="upg-meta">
      <span>Level <b>${w.base_level}</b></span>
      <span>HP <b>${curHp}</b>${pending ? ` → <b>${curHp + pending.hp}</b>` : ''}</span>
      <span>+${w.hp_bonus} HP from ${w.upgrades_done} upgrade${w.upgrades_done !== 1 ? 's' : ''}</span>
    </div>`;

    let statusHtml;
    if (pending) {
      statusHtml = `<div class="upgrade-budget">
        <span class="budget-used">Upgrade ${w.upgrades_done + 1} / ${w.upgrade_cap} — auto +${pending.hp} HP</span>
        <span class="budget-next"><b>${poolLeft()}</b> EV left — ${selected ? 'placing in ' + esc(selected) : 'select an ability below'}</span>
      </div>`;
    } else if (w.next_upgrade) {
      const c = w.next_cost;
      statusHtml = `<div class="upgrade-budget">
        <span class="budget-used">${w.upgrades_done} / ${w.upgrade_cap} upgrades</span>
        <span class="budget-next">Next: +${w.next_upgrade.hp} HP, ${w.next_upgrade.ev} EV${c ? ` · ${c.quantity} ${esc(c.material_name ?? c.material)}` : ''}</span>
        <button class="upg-btn" onclick="Views.upgrade.startUpgrade()">Start upgrade</button>
      </div>`;
    } else {
      statusHtml = `<div class="upgrade-budget"><span class="budget-used">${w.upgrades_done} / ${w.upgrade_cap} upgrades</span><span class="budget-cap">Fully upgraded for this rank — level up to unlock more</span></div>`;
    }

    let sectionsHtml = '';
    for (const cat of CAT_ORDER) {
      const actions = w.actions.filter(a => a.category === cat);
      if (actions.length === 0) continue;
      sectionsHtml += `<div class="upgrade-section"><p class="upg-cat-label">${CAT_LABELS[cat]}</p>`;
      for (const a of actions) sectionsHtml += renderActionRow(a);
      sectionsHtml += '</div>';
    }

    let controls = '';
    if (pending) {
      controls = `<div class="fe-controls">
        <button onclick="Views.upgrade.cancelUpgrade()">Cancel</button>
        <button class="upg-btn" onclick="Views.upgrade.applyUpgrade()" ${poolLeft() !== 0 ? 'disabled' : ''}>Apply upgrade</button>
      </div>`;
    }

    panel.innerHTML = metaHtml + statusHtml + sectionsHtml + controls;
  }

  function pendSumOf(a) {
    const d = pending?.deltas[a.name];
    if (Array.isArray(d)) return d.reduce((s, v) => s + v, 0);
    return d ?? 0;
  }

  function renderActionRow(a) {
    if (!a.upgradeable) {
      return `<div class="upg-action dim"><span class="upg-name">${esc(a.name)}</span><span class="cannot-upg">Cannot be upgraded</span></div>`;
    }
    const valueBonus = a.type === 'value' ? a.base_bonus + a.player_bonus
                                          : a.player_bonus.reduce((s, v) => s + v, 0) + a.base_bonus.reduce((s, v) => s + v, 0);
    const bonusTag   = valueBonus > 0 ? `<span class="bonus-tag">+${valueBonus}</span>` : '';
    const statHtml   = a.type === 'value' ? `${a.effective}` : fieldSummary(a.effective);

    if (!pending) {
      return `<div class="upg-action"><span class="upg-name">${esc(a.name)}</span><span class="upg-stat">${statHtml}${bonusTag}</span></div>`;
    }

    const left    = poolLeft();
    const pend     = pendSumOf(a);
    const pendTag  = pend > 0 ? `<span class="bonus-tag pend">+${pend}</span>` : '';

    if (a.name !== selected) {
      // Intermediary: a clickable row to select where points go.
      return `<div class="upg-action upg-selectable" onclick="Views.upgrade.selectAction('${esc(a.name)}')">
        <span class="upg-name">${esc(a.name)}</span><span class="upg-stat">${statHtml}${pendTag}</span><span class="upg-pick">add ⊕</span>
      </div>`;
    }

    // Selected ability — the points editor.
    if (a.type === 'value') {
      const v = a.effective;
      return `<div class="upg-action upg-editing"><span class="upg-name">${esc(a.name)}</span>
        <span class="upg-stat">${v}${pendTag}</span>
        <div class="fe-btns">
          <button onclick="Views.upgrade.adjustValue('${esc(a.name)}', -1)" ${pend > 0 ? '' : 'disabled'}>−</button>
          <button onclick="Views.upgrade.adjustValue('${esc(a.name)}', 1)" ${left > 0 ? '' : 'disabled'}>+</button>
        </div></div>`;
    }
    const pendArr = Array.isArray(pending.deltas[a.name]) ? pending.deltas[a.name] : a.base.map(() => 0);
    let entries = '';
    for (let i = 0; i < a.field_len; i++) {
      entries += `<div class="fe-entry"><span class="fe-val">${a.effective[i] + pendArr[i]}</span><div class="fe-btns">
        <button onclick="Views.upgrade.adjustField('${esc(a.name)}', ${i}, -1)" ${pendArr[i] > 0 ? '' : 'disabled'}>−</button>
        <button onclick="Views.upgrade.adjustField('${esc(a.name)}', ${i}, 1)" ${left > 0 ? '' : 'disabled'}>+</button>
      </div></div>`;
    }
    return `<div class="upg-action upg-editing upg-action-field"><span class="upg-name">${esc(a.name)}</span><div class="fe-entries">${entries}</div></div>`;
  }

  function startUpgrade() {
    const n = selectedWeapon?.next_upgrade;
    if (!n) return;
    pending = { ev: n.ev, hp: n.hp, deltas: {} };
    selected = null;
    renderUpgradePanel();
  }
  function cancelUpgrade() { pending = null; selected = null; renderUpgradePanel(); }
  function selectAction(name) { if (pending) { selected = name; renderUpgradePanel(); } }

  function adjustField(name, i, dir) {
    if (!pending) return;
    if (dir > 0 && poolLeft() <= 0) return;
    const a = selectedWeapon.actions.find(x => x.name === name);
    if (!Array.isArray(pending.deltas[name])) pending.deltas[name] = a.base.map(() => 0);
    const arr = pending.deltas[name];
    if (dir < 0 && arr[i] <= 0) return;
    arr[i] += dir;
    if (arr.every(v => v === 0)) delete pending.deltas[name];
    renderUpgradePanel();
  }
  function adjustValue(name, dir) {
    if (!pending) return;
    if (dir > 0 && poolLeft() <= 0) return;
    const cur = pending.deltas[name] ?? 0;
    if (dir < 0 && cur <= 0) return;
    if (cur + dir === 0) delete pending.deltas[name];
    else pending.deltas[name] = cur + dir;
    renderUpgradePanel();
  }

  async function applyUpgrade() {
    if (!pending || !selectedWeapon || poolLeft() !== 0) return;
    const res = await fetch(`/api/upgrade/${selectedWeapon.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distribution: pending.deltas }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { pending = null; selected = null; await mountLayout(); }
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
    upgradeData = null; selectedWeapon = null; pending = null; selected = null;
  }

  window.Views = window.Views ?? {};
  window.Views.upgrade = {
    mount, unmount,
    pickWeapon, startUpgrade, cancelUpgrade, selectAction, adjustField, adjustValue, applyUpgrade,
  };
  window.showToast = (msg) => toast(msg, true);
})();
