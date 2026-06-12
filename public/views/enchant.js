// View: Enchant — a power layer separate from upgrades. Four enchant types share
// 3 slots: Health (flat HP), Sidaev Strike (melee ability), Sidaev Pulse (ranged
// ability), and Upgrade (set EV + optional retype, once per ability).
(function() {
  let data    = null;   // /api/enchant response
  let weapon  = null;   // selected weapon
  let pending = null;   // upgrade-enchant editor state

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

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
    await load();
  }

  function layoutChangedHandler() { if (data) load(); }
  function panel() { return document.getElementById('enchant-panel'); }

  async function load() {
    const res = await fetch('/api/enchant');
    if (!res.ok) { panel().innerHTML = '<p class="empty">Could not load enchant data.</p>'; return; }
    data = await res.json();

    const picker = document.getElementById('enchant-weapon-picker');
    document.getElementById('enchant-materials').textContent =
      `Thuvel ${data.materials.thuvel} · Hiruos ${data.materials.hiruos} · Nodol ${data.materials.nodol}`;

    picker.innerHTML = '';
    if (data.weapons.length === 0) {
      picker.innerHTML = '<option disabled>No weapons owned</option>';
      panel().innerHTML = '<p class="empty">Craft a weapon first.</p>';
      return;
    }
    for (const w of data.weapons) {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.name} (L${w.level})${w.equipped ? ' (equipped)' : ''} — ${w.enchants_used}/${w.enchant_slots} enchants`;
      picker.appendChild(opt);
    }
    const prev = weapon?.id;
    weapon = data.weapons.find(w => w.id === prev) ?? data.weapons[0];
    picker.value = weapon.id;
    pending = null;
    render();
  }

  function pickWeapon(id) { weapon = data?.weapons.find(w => w.id === id) ?? null; pending = null; render(); }

  function currentEnchantsHtml(w) {
    const keys = Object.keys(w.enchants);
    if (keys.length === 0) return '<p class="enchant-none">No enchants yet.</p>';
    let html = '<div class="enchant-current">';
    for (const k of keys) {
      const e = w.enchants[k];
      let label = '';
      if (e.type === 'health')      label = `Health +${w.health_hp} HP`;
      else if (e.type === 'melee')  label = `Sidaev Strike [${w.melee.field.join(', ')}]`;
      else if (e.type === 'ranged') label = `Sidaev Pulse [${w.ranged.field.join(', ')}]`;
      else if (e.type === 'upgrade') {
        const rt = (e.damage_type || e.damage_subtype) ? ` → ${[e.damage_type, e.damage_subtype].filter(Boolean).join('/')}` : '';
        label = `Upgrade: ${e.action} +${w.upgrade_ev} EV${rt}`;
      }
      html += `<span class="enchant-tag">${esc(label)}</span>`;
    }
    return html + '</div>';
  }

  function render() {
    const p = panel();
    if (!weapon) { p.innerHTML = ''; return; }
    const w = weapon, encLvl = data.enchanter_level;
    const slotsUsed = w.enchants_used, slotsFull = slotsUsed >= w.enchant_slots;
    const req  = data.level_required;
    const cost = w.cost;
    const costStr = Object.entries(cost).map(([m, q]) => `${q} ${m}`).join(', ');
    const canAfford = Object.entries(cost).every(([m, q]) => (data.materials[m] ?? 0) >= q);

    function card(type, title, desc) {
      const applied = !!w.enchants[type];
      let action;
      if (applied)               action = '<span class="enchant-applied">Applied</span>';
      else if (slotsFull)        action = '<span class="cannot-upg">Slots full</span>';
      else if (encLvl < req[type]) action = `<span class="cannot-upg">Enchanter L${req[type]}</span>`;
      else if (type === 'upgrade') action = `<button class="upg-btn" onclick="Views.enchant.startUpgrade()">Choose ability</button>`;
      else                       action = `<button class="upg-btn" ${canAfford ? '' : 'disabled'} onclick="Views.enchant.applyType('${type}')">Apply</button>`;
      return `<div class="upg-action${applied ? ' dim' : ''}">
        <div class="ench-card-main"><span class="upg-name">${esc(title)}</span><span class="upg-stat">${esc(desc)}</span></div>
        ${action}
      </div>`;
    }

    let html = `<div class="upgrade-budget"><span class="budget-used">${slotsUsed} / ${w.enchant_slots} slots used</span>${slotsFull ? '<span class="budget-cap">Full</span>' : ''}</div>`;
    html += `<div class="upgrade-section"><p class="upg-cat-label">Current enchants</p>${currentEnchantsHtml(w)}</div>`;
    html += `<div class="upgrade-section"><p class="upg-cat-label">Add enchant <span class="ench-cost-note">(cost: ${esc(costStr)})</span></p>`;
    html += card('health', 'Health', `+${w.health_hp} HP`);
    html += card('melee',  'Sidaev Strike', `${w.melee.damage_type}/${w.melee.damage_subtype} · range ${w.melee.range} · [${w.melee.field.join(', ')}]`);
    html += card('ranged', 'Sidaev Pulse',  `${w.ranged.damage_type}/${w.ranged.damage_subtype} · range ${w.ranged.range} · [${w.ranged.field.join(', ')}]`);
    html += card('upgrade','Upgrade ability', `+${w.upgrade_ev} EV to one ability, optional retype`);
    html += '</div>';

    if (pending) html += `<div id="enchant-editor">${renderUpgradeEditor()}</div>`;
    p.innerHTML = html;
  }

  async function applyType(type) { if (weapon) await post({ type }); }

  function startUpgrade() {
    const opts = weapon.actions.filter(a => a.upgradeable && !a.enchanted);
    if (opts.length === 0) { toast('No abilities left to enchant on this weapon.', false); return; }
    const a = opts[0];
    pending = {
      action: a.name,
      delta: a.type === 'field' ? new Array(a.field_len).fill(0) : weapon.upgrade_ev,
      retype: false,
      damage_type: data.damage_types[0],
      damage_subtype: data.damage_subtypes[0],
    };
    render();
  }

  function renderUpgradeEditor() {
    const w = weapon, ev = w.upgrade_ev, p = pending;
    const opts = w.actions.filter(a => a.upgradeable && !a.enchanted);
    const a = w.actions.find(x => x.name === p.action);
    if (!a) return '';

    let entriesHtml = '', sumOk = true, remHtml = '';
    if (a.type === 'field') {
      const targetSum = ev * a.field_len;
      const spent = p.delta.reduce((s, v) => s + v, 0);
      const rem = targetSum - spent;
      sumOk = rem === 0;
      for (let i = 0; i < p.delta.length; i++) {
        const eff = a.effective[i] + p.delta[i];
        entriesHtml += `<div class="fe-entry"><span class="fe-val">${eff}</span><div class="fe-btns">
          <button onclick="Views.enchant.adj(${i}, -1)" ${p.delta[i] > 0 ? '' : 'disabled'}>−</button>
          <button onclick="Views.enchant.adj(${i},  1)" ${rem > 0 ? '' : 'disabled'}>+</button>
        </div></div>`;
      }
      remHtml = `<p class="fe-budget">${rem} point${rem !== 1 ? 's' : ''} to place (EV +${ev}) <button class="ench-even" onclick="Views.enchant.evenSplit()">even split</button></p>`;
    } else {
      entriesHtml = `<div class="fe-entry"><span class="fe-val">${a.effective + ev}</span></div>`;
      remHtml = `<p class="fe-budget">+${ev} to value</p>`;
    }

    const cost = w.cost;
    const costStr = Object.entries(cost).map(([m, q]) => `${q} ${m}`).join(', ');
    const canAfford = Object.entries(cost).every(([m, q]) => (data.materials[m] ?? 0) >= q);

    return `<div class="field-editor">
      <div class="enchant-dropdowns">
        <label>Ability:</label>
        <select onchange="Views.enchant.setAction(this.value)">
          ${opts.map(o => `<option value="${esc(o.name)}" ${o.name === p.action ? 'selected' : ''}>${esc(o.name)} (${esc(o.label)})</option>`).join('')}
        </select>
      </div>
      ${remHtml}
      <div class="fe-entries">${entriesHtml}</div>
      <div class="enchant-retype">
        <label><input type="checkbox" ${p.retype ? 'checked' : ''} onchange="Views.enchant.toggleRetype(this.checked)"> Change damage type</label>
        ${p.retype ? `
          <select onchange="Views.enchant.setDT(this.value)">${data.damage_types.map(t => `<option ${t === p.damage_type ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select onchange="Views.enchant.setDST(this.value)">${data.damage_subtypes.map(s => `<option ${s === p.damage_subtype ? 'selected' : ''}>${s}</option>`).join('')}</select>
        ` : ''}
      </div>
      <p class="enchant-cost ${canAfford ? '' : 'cant-afford'}">Cost: ${esc(costStr)}</p>
      <div class="fe-controls">
        <button onclick="Views.enchant.cancel()">Cancel</button>
        <button class="upg-btn" onclick="Views.enchant.confirmUpgrade()" ${(!canAfford || !sumOk) ? 'disabled' : ''}>Apply enchant</button>
      </div>
    </div>`;
  }

  function setAction(name) {
    const a = weapon.actions.find(x => x.name === name);
    if (!a) return;
    pending.action = name;
    pending.delta = a.type === 'field' ? new Array(a.field_len).fill(0) : weapon.upgrade_ev;
    render();
  }
  function adj(i, dir) {
    if (!pending || !Array.isArray(pending.delta)) return;
    const a = weapon.actions.find(x => x.name === pending.action);
    const target = weapon.upgrade_ev * a.field_len;
    const spent = pending.delta.reduce((s, v) => s + v, 0);
    if (dir > 0 && spent >= target) return;
    if (dir < 0 && pending.delta[i] <= 0) return;
    pending.delta[i] += dir;
    render();
  }
  function evenSplit() {
    const a = weapon.actions.find(x => x.name === pending.action);
    const n = a.field_len, total = weapon.upgrade_ev * n;
    const base = Math.floor(total / n);
    let rem = total - base * n;
    pending.delta = new Array(n).fill(base);
    for (let i = 0; i < n && rem > 0; i++) { pending.delta[i]++; rem--; }
    render();
  }
  function toggleRetype(on) { pending.retype = on; render(); }
  function setDT(v)  { pending.damage_type = v; render(); }
  function setDST(v) { pending.damage_subtype = v; render(); }
  function cancel()  { pending = null; render(); }

  async function confirmUpgrade() {
    if (!pending || !weapon) return;
    const body = { type: 'upgrade', action: pending.action, delta: pending.delta };
    if (pending.retype) { body.damage_type = pending.damage_type; body.damage_subtype = pending.damage_subtype; }
    await post(body);
  }

  async function post(body) {
    const res = await fetch(`/api/enchant/${weapon.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { pending = null; await load(); }
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
    data = null; weapon = null; pending = null;
  }

  window.Views = window.Views ?? {};
  window.Views.enchant = {
    mount, unmount, pickWeapon, applyType,
    startUpgrade, setAction, adj, evenSplit, toggleRetype, setDT, setDST, cancel, confirmUpgrade,
  };
  window.showToast = (msg) => toast(msg, true);
})();
