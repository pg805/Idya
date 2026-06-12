// View: Upgrade — each upgrade gives an automatic HP gain + a pool of points.
// A point = +1 EV. You pick an ability, choose how many points to pour in; for a
// ranged ability (a field) that hands you (points × field-length) sub-points to
// spread across the entries (so its average rises by that many points). Repeat
// across abilities until the pool is spent, then commit the whole upgrade.
(function() {
  let upgradeData    = null;
  let selectedWeapon = null;
  let pending        = null;  // { ev, hp, committed: { [name]: number[] | number } }
  let editing        = null;  // { name, type, fieldLen, k, sub: number[]|null }

  const CAT_ORDER  = ['defend', 'defend_crit', 'attack', 'attack_crit', 'special', 'special_crit'];
  const CAT_LABELS = { defend: 'Defend', defend_crit: 'Defend Crit', attack: 'Attack', attack_crit: 'Attack Crit', special: 'Special', special_crit: 'Special Crit' };

  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fieldSummary(field) { return `<span class="field-rolls">[${field.join(', ')}]</span>`; }
  function actionByName(name) { return selectedWeapon.actions.find(a => a.name === name); }

  async function mount(root) {
    setLayoutTitle('Upgrade Weapons');
    root.innerHTML = `
      <section id="upgrade-tab">
        <div id="upgrade-header"><select id="weapon-picker" onchange="Views.upgrade.pickWeapon(this.value)"></select></div>
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
    pending = null; editing = null;
    renderUpgradePanel();
  }

  // ── EV bookkeeping ──
  function evOf(name, val) {
    const a = actionByName(name);
    return a.type === 'value' ? val : val.reduce((s, v) => s + v, 0) / a.field_len;
  }
  function committedEv() {
    if (!pending) return 0;
    let e = 0;
    for (const [n, v] of Object.entries(pending.committed)) e += evOf(n, v);
    return e;
  }
  function poolForAbility() { return pending ? pending.ev - committedEv() : 0; }  // max points this ability can take
  function poolLeft() { return pending ? pending.ev - committedEv() - (editing ? editing.k : 0) : 0; }

  // committed delta on an action (number for value, array for field)
  function committedDelta(name) {
    const c = pending?.committed[name];
    if (c !== undefined) return c;
    return actionByName(name).type === 'value' ? 0 : actionByName(name).base.map(() => 0);
  }

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
        <span class="budget-next"><b>${poolLeft()}</b> point${poolLeft() !== 1 ? 's' : ''} left${editing ? '' : ' — pick an ability'}</span>
      </div>`;
    } else if (w.next_upgrade) {
      const c = w.next_cost;
      statusHtml = `<div class="upgrade-budget">
        <span class="budget-used">${w.upgrades_done} / ${w.upgrade_cap} upgrades</span>
        <span class="budget-next">Next: +${w.next_upgrade.hp} HP, ${w.next_upgrade.ev} points${c ? ` · ${c.quantity} ${esc(c.material_name ?? c.material)}` : ''}</span>
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
    if (pending && !editing) {
      const done = committedEv() === pending.ev;
      controls = `<div class="fe-controls">
        <button onclick="Views.upgrade.cancelUpgrade()">Cancel</button>
        <button class="upg-btn" onclick="Views.upgrade.applyUpgrade()" ${done ? '' : 'disabled'}>Apply upgrade</button>
      </div>`;
    }
    panel.innerHTML = metaHtml + statusHtml + sectionsHtml + controls;
  }

  function bonusTagOf(a) {
    const cur = a.type === 'value' ? a.base_bonus + a.player_bonus
                                   : a.player_bonus.reduce((s, v) => s + v, 0) + a.base_bonus.reduce((s, v) => s + v, 0);
    const pendC = committedDelta(a.name);
    const pend = a.type === 'value' ? pendC : pendC.reduce((s, v) => s + v, 0);
    const parts = [];
    if (cur > 0)  parts.push(`<span class="bonus-tag">+${cur}</span>`);
    if (pend > 0) parts.push(`<span class="bonus-tag pend">+${pend}</span>`);
    return parts.join(' ');
  }

  function renderActionRow(a) {
    if (!a.upgradeable) {
      return `<div class="upg-action dim"><span class="upg-name">${esc(a.name)}</span><span class="cannot-upg">Cannot be upgraded</span></div>`;
    }
    const statHtml = a.type === 'value' ? `${a.effective}` : fieldSummary(a.effective);

    // editor for the ability being edited
    if (editing && editing.name === a.name) return renderEditor(a);

    // plain row (no upgrade in progress, or another ability is being edited)
    const clickable = pending && !editing;
    const click = clickable ? ` class="upg-action upg-selectable" onclick="Views.upgrade.selectAction('${esc(a.name)}')"` : ' class="upg-action"';
    const pick  = clickable ? '<span class="upg-pick">add ⊕</span>' : '';
    return `<div${click}><span class="upg-name">${esc(a.name)}</span><span class="upg-stat">${statHtml} ${bonusTagOf(a)}</span>${pick}</div>`;
  }

  function renderEditor(a) {
    const maxK   = poolForAbility();
    const kCtrl  = `<span class="ev-k"><button onclick="Views.upgrade.adjustK(-1)" ${editing.k > 0 ? '' : 'disabled'}>−</button>
      <b>${editing.k}</b> point${editing.k !== 1 ? 's' : ''}
      <button onclick="Views.upgrade.adjustK(1)" ${editing.k < maxK ? '' : 'disabled'}>+</button></span>`;

    let body = '';
    let canAdd = false;
    if (a.type === 'value') {
      canAdd = editing.k > 0;
      body = `<span class="upg-stat">${a.effective + (committedDelta(a.name)) + editing.k} (+${editing.k})</span>`;
    } else {
      const need   = editing.k * a.field_len;
      const placed = editing.sub.reduce((s, v) => s + v, 0);
      canAdd = editing.k > 0 && placed === need;
      const base = committedDelta(a.name);
      let entries = '';
      for (let i = 0; i < a.field_len; i++) {
        entries += `<div class="fe-entry"><span class="fe-val">${a.effective[i] + base[i] + editing.sub[i]}</span><div class="fe-btns">
          <button onclick="Views.upgrade.adjustSub(${i}, -1)" ${editing.sub[i] > 0 ? '' : 'disabled'}>−</button>
          <button onclick="Views.upgrade.adjustSub(${i}, 1)" ${placed < need ? '' : 'disabled'}>+</button>
        </div></div>`;
      }
      body = `<p class="fe-budget">${editing.k > 0 ? `place ${need - placed} / ${need} sub-points (+${editing.k} EV)` : 'add points above first'}</p>
        <div class="fe-entries">${entries}</div>`;
    }

    return `<div class="upg-action upg-editing">
      <div class="upg-edit-head"><span class="upg-name">${esc(a.name)}</span>${kCtrl}</div>
      ${body}
      <div class="fe-controls">
        <button onclick="Views.upgrade.cancelEdit()">Back</button>
        <button class="upg-btn" onclick="Views.upgrade.addEdit()" ${canAdd ? '' : 'disabled'}>Add to upgrade</button>
      </div>
    </div>`;
  }

  function startUpgrade() {
    const n = selectedWeapon?.next_upgrade;
    if (!n) return;
    pending = { ev: n.ev, hp: n.hp, committed: {} };
    editing = null;
    renderUpgradePanel();
  }
  function cancelUpgrade() { pending = null; editing = null; renderUpgradePanel(); }

  function selectAction(name) {
    if (!pending || editing) return;
    const a = actionByName(name);
    editing = { name, type: a.type, fieldLen: a.field_len ?? 0, k: 0, sub: a.type === 'value' ? null : a.base.map(() => 0) };
    renderUpgradePanel();
  }
  function cancelEdit() { editing = null; renderUpgradePanel(); }

  function adjustK(dir) {
    if (!editing) return;
    const next = editing.k + dir;
    if (next < 0 || next > poolForAbility()) return;
    editing.k = next;
    if (editing.type !== 'value') {
      const need = editing.k * editing.fieldLen;
      let placed = editing.sub.reduce((s, v) => s + v, 0);
      // trim placed sub-points if we lowered k below what's placed
      for (let i = editing.sub.length - 1; i >= 0 && placed > need; i--) {
        const take = Math.min(editing.sub[i], placed - need);
        editing.sub[i] -= take; placed -= take;
      }
    }
    renderUpgradePanel();
  }
  function adjustSub(i, dir) {
    if (!editing || editing.type === 'value') return;
    const need = editing.k * editing.fieldLen;
    const placed = editing.sub.reduce((s, v) => s + v, 0);
    if (dir > 0 && placed >= need) return;
    if (dir < 0 && editing.sub[i] <= 0) return;
    editing.sub[i] += dir;
    renderUpgradePanel();
  }
  function addEdit() {
    if (!editing) return;
    const a = actionByName(editing.name);
    if (a.type === 'value') {
      if (editing.k <= 0) return;
      pending.committed[editing.name] = (pending.committed[editing.name] ?? 0) + editing.k;
    } else {
      const placed = editing.sub.reduce((s, v) => s + v, 0);
      if (placed !== editing.k * editing.fieldLen || editing.k <= 0) return;
      const base = committedDelta(editing.name);
      const merged = base.map((v, i) => v + editing.sub[i]);
      if (merged.every(v => v === 0)) delete pending.committed[editing.name];
      else pending.committed[editing.name] = merged;
    }
    editing = null;
    renderUpgradePanel();
  }

  async function applyUpgrade() {
    if (!pending || editing || committedEv() !== pending.ev) return;
    const res = await fetch(`/api/upgrade/${selectedWeapon.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distribution: pending.committed }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { pending = null; editing = null; await mountLayout(); }
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
    upgradeData = null; selectedWeapon = null; pending = null; editing = null;
  }

  window.Views = window.Views ?? {};
  window.Views.upgrade = {
    mount, unmount,
    pickWeapon, startUpgrade, cancelUpgrade, selectAction, cancelEdit, adjustK, adjustSub, addEdit, applyUpgrade,
  };
  window.showToast = (msg) => toast(msg, true);
})();
