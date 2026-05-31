let data         = null;
let activeFilter = 'all';
let openRecipe   = null;

let upgradeData      = null;
let selectedWeapon   = null;  // weapon object from upgradeData
let pendingDelta     = null;  // { actionName, delta: number[] } for field editor

// ---- Auth ----

function getToken() { return localStorage.getItem('shop_auth') ?? ''; }

function authHeaders(json = false) {
  const h = { 'Authorization': `Bearer ${getToken()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

(function initAuth() {
  const auth = new URLSearchParams(location.search).get('auth');
  if (auth) {
    localStorage.setItem('shop_auth', auth);
    history.replaceState(null, '', location.pathname);
  }
})();

// ---- Load ----

async function load() {
  if (!getToken()) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('auth-error').style.display = 'flex';
    return;
  }
  const res = await fetch('/api/craft', { headers: authHeaders() });
  if (res.status === 401) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('auth-error').style.display = 'flex';
    return;
  }
  data = await res.json();
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  render();
}

// ---- Tabs ----

function showTab(tab) {
  document.querySelectorAll('.page-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('craft-tab').style.display   = tab === 'craft'   ? '' : 'none';
  document.getElementById('upgrade-tab').style.display = tab === 'upgrade' ? '' : 'none';
  document.getElementById('enchant-tab').style.display = tab === 'enchant' ? '' : 'none';
  if (tab === 'upgrade' && !upgradeData) loadUpgrade();
  if (tab === 'enchant') loadEnchant();
}

// ---- Craft render ----

const PROF_SHOP = { lumberjack: 'lumberjack', blacksmith: 'blacksmith', enchanter: 'enchanting_shop' };

function render() {
  document.getElementById('char-name').textContent = data.characterName;
  document.getElementById('korel-val').textContent = `${data.korel.toLocaleString()} korel`;
  renderProfessions();
  renderRecipes();
}

function renderProfessions() {
  const container = document.getElementById('professions');
  container.innerHTML = '';
  for (const [key, prof] of Object.entries(data.professions)) {
    const pct    = prof.level / prof.maxLevel * 100;
    const atMax  = prof.level >= prof.maxLevel;
    const canAfford = prof.nextCost != null && data.korel >= prof.nextCost;
    const costLabel = prof.nextCost != null ? prof.nextCost.toLocaleString() : null;
    const card = document.createElement('div');
    card.className = 'prof-card';
    card.innerHTML = `
      <p class="prof-name">${esc(prof.label)}</p>
      <p class="prof-level">${prof.level}<span> / ${prof.maxLevel}</span></p>
      <div class="prof-bar-bg"><div class="prof-bar" style="width:${pct}%"></div></div>
      <div class="prof-footer">
        <p class="prof-meta">${atMax ? 'Mastered' : costLabel != null ? `Next: ${costLabel} korel` : 'Cap reached'}</p>
        ${!atMax && costLabel != null
          ? `<button class="train-btn" onclick="doTrain('${PROF_SHOP[key]}')" ${canAfford ? '' : 'disabled'}>Train ${esc(prof.label)}</button>`
          : ''}
      </div>
    `;
    container.appendChild(card);
  }
}

async function doTrain(shopKey) {
  const res  = await fetch(`/api/shop/${shopKey}/train`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({}) });
  const body = await res.json();
  showToast(body.message ?? (body.error || 'Error'));
  if (body.success) {
    const refreshed = await fetch('/api/craft', { headers: authHeaders() });
    data = await refreshed.json();
    render();
  }
}

function renderRecipes() {
  const list = document.getElementById('recipe-list');
  const visible = data.recipes.filter(r => activeFilter === 'all' || r.profession === activeFilter);

  if (visible.length === 0) {
    list.innerHTML = '<p class="empty">No recipes here yet.</p>';
    return;
  }

  list.innerHTML = '';
  for (const r of visible) {
    const isOpen = openRecipe === r.id;
    const badge  = r.available        ? `<span class="recipe-badge badge-available">Ready</span>`
                 : !r.levelMet        ? `<span class="recipe-badge badge-locked">Lvl ${r.required_level} ${profLabel(r.profession)}</span>`
                 :                      `<span class="recipe-badge badge-materials">Need materials</span>`;

    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.innerHTML = `
      <div class="recipe-row${isOpen ? ' open' : ''}" onclick="toggleRecipe('${r.id}')">
        <span class="recipe-name${!r.levelMet ? ' dim' : ''}">${esc(r.name)}</span>
        ${badge}
      </div>
      ${isOpen ? `
        <div class="recipe-detail">
          ${r.description ? `<p class="recipe-desc">${esc(r.description)}</p>` : ''}
          <div class="recipe-meta">
            <div>
              <p class="meta-label">Ingredients</p>
              <div class="ingredient-list">
                ${r.ingredients.map(i => {
                  const have = data.inventory[i.item_id] ?? 0;
                  const ok   = have >= i.quantity;
                  return `<span class="ingredient">
                    <span>${esc(i.name)}</span>
                    <span class="${ok ? 'have' : 'missing'}">${have} / ${i.quantity}</span>
                  </span>`;
                }).join('')}
              </div>
            </div>
            <div>
              <p class="meta-label">Output</p>
              <div class="output-line">
                <span>${esc(r.name)}</span>
                ${r.output.quantity && r.output.quantity > 1 ? `<span style="color:#445">×${r.output.quantity}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="craft-row">
            <input class="craft-qty" id="qty-${r.id}" type="number" min="1" max="99" value="1" ${r.available ? '' : 'disabled'}>
            <button class="craft-btn" onclick="doCraft('${r.id}')" ${r.available ? '' : 'disabled'}>Craft</button>
          </div>
        </div>` : ''}
    `;
    list.appendChild(card);
  }
}

function profLabel(key) {
  return { lumberjack: 'LJ', blacksmith: 'BS', enchanter: 'EN' }[key] ?? key;
}

function toggleRecipe(id) {
  openRecipe = openRecipe === id ? null : id;
  renderRecipes();
}

function filterRecipes(prof) {
  activeFilter = prof;
  openRecipe   = null;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.prof === prof);
  });
  renderRecipes();
}

// ---- Craft action ----

async function doCraft(recipeId) {
  const quantity = parseInt(document.getElementById(`qty-${recipeId}`)?.value ?? '1', 10) || 1;
  const res = await fetch(`/api/craft/${recipeId}`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({ quantity }),
  });
  const r = await res.json();
  toast(r.message ?? r.error, r.success !== false);
  if (r.success) {
    openRecipe = null;
    const fresh = await fetch('/api/craft', { headers: authHeaders() });
    if (fresh.ok) { data = await fresh.json(); render(); }
  }
}

// ---- Upgrade load ----

async function loadUpgrade() {
  const res = await fetch('/api/upgrade', { headers: authHeaders() });
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
    opt.value = w.weapon_key;
    opt.textContent = w.name + (w.equipped ? ' (equipped)' : '');
    picker.appendChild(opt);
  }
  selectedWeapon = upgradeData.weapons[0];
  picker.value = selectedWeapon.weapon_key;
  renderUpgradePanel();
}

async function refreshUpgrade() {
  const prevKey = selectedWeapon?.weapon_key;
  const res = await fetch('/api/upgrade', { headers: authHeaders() });
  if (res.ok) {
    upgradeData = await res.json();
    const picker = document.getElementById('weapon-picker');
    picker.innerHTML = '';
    for (const w of upgradeData.weapons) {
      const opt = document.createElement('option');
      opt.value = w.weapon_key;
      opt.textContent = w.name + (w.equipped ? ' (equipped)' : '');
      picker.appendChild(opt);
    }
    selectedWeapon = upgradeData.weapons.find(w => w.weapon_key === prevKey) ?? upgradeData.weapons[0] ?? null;
    if (selectedWeapon) picker.value = selectedWeapon.weapon_key;
    renderUpgradePanel();
  }
}

function pickWeapon(key) {
  selectedWeapon = upgradeData?.weapons.find(w => w.weapon_key === key) ?? null;
  pendingDelta = null;
  renderUpgradePanel();
}

// ---- Upgrade render ----

const CAT_ORDER = ['defend', 'defend_crit', 'attack', 'attack_crit', 'special', 'special_crit'];
const CAT_LABELS = { defend: 'Defend', defend_crit: 'Defend Crit', attack: 'Attack', attack_crit: 'Attack Crit', special: 'Special', special_crit: 'Special Crit' };

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
        : nextCost ? `<span class="budget-next">Next: <b>${nextCost.quantity}</b> ${esc(nextCost.material)}</span>` : ''}
    </div>`;

  let sectionsHtml = '';
  for (const cat of CAT_ORDER) {
    const actions = w.actions.filter(a => a.category === cat);
    if (actions.length === 0) continue;
    sectionsHtml += `<div class="upgrade-section"><p class="upg-cat-label">${CAT_LABELS[cat]}</p>`;
    for (const a of actions) sectionsHtml += renderActionRow(a, w, atCap);
    sectionsHtml += '</div>';
  }

  panel.innerHTML = budgetHtml + sectionsHtml;

  if (pendingDelta) renderFieldEditor();
}

function renderActionRow(a, w, atCap) {
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
      ? `<button class="upg-btn" onclick="upgradeValue('${esc(a.name)}')">+1</button>` : '';
    return `<div class="upg-action">
      <span class="upg-name">${esc(a.name)}</span>
      <span class="upg-stat">${a.effective}${bonusTag}</span>
      ${btn}
    </div>`;
  }

  // field action
  const playerTotal = a.player_bonus.reduce((s, v) => s + v, 0);
  const baseTotal   = a.base_bonus.reduce((s, v) => s + v, 0);
  const totalBonus  = playerTotal + baseTotal;
  const bonusTag    = totalBonus > 0 ? `<span class="bonus-tag">+${totalBonus}</span>` : '';
  const statText    = fieldSummary(a.effective);
  const btn = (!atCap && !pendingDelta && !editingThis)
    ? `<button class="upg-btn" onclick="startFieldEdit('${esc(a.name)}', ${a.field_len})">Upgrade</button>` : '';

  return `<div class="upg-action" id="upg-action-${safeId(a.name)}">
    <span class="upg-name">${esc(a.name)}</span>
    <span class="upg-stat">${statText}${bonusTag}</span>
    ${btn}
    ${editingThis ? '<div id="field-editor"></div>' : ''}
  </div>`;
}

function fieldSummary(field) {
  const min = Math.min(...field);
  const max = Math.max(...field);
  const avg = (field.reduce((a, b) => a + b, 0) / field.length).toFixed(1);
  return `${min}–${max} <span class="field-avg">avg ${avg}</span>`;
}

function safeId(name) { return name.replace(/[^a-zA-Z0-9]/g, '-'); }

// ---- Field editor ----

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
        <button onclick="adjustDelta(${i}, -1)" ${canMinus ? '' : 'disabled'}>−</button>
        <button onclick="adjustDelta(${i},  1)" ${canPlus  ? '' : 'disabled'}>+</button>
      </div>
    </div>`;
  }

  el.innerHTML = `<div class="field-editor">
    <p class="fe-budget">${rem} point${rem !== 1 ? 's' : ''} to place</p>
    <div class="fe-entries">${entriesHtml}</div>
    <div class="fe-controls">
      <button onclick="cancelFieldEdit()">Cancel</button>
      <button class="upg-btn" onclick="confirmFieldEdit()" ${rem !== 0 ? 'disabled' : ''}>Confirm</button>
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
  const res = await fetch(`/api/upgrade/${selectedWeapon.weapon_key}`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({ action: pendingDelta.actionName, delta: pendingDelta.delta }),
  });
  const r = await res.json();
  toast(r.message ?? r.error, r.success !== false);
  if (r.success) { pendingDelta = null; await refreshUpgrade(); }
}

async function upgradeValue(actionName) {
  if (!selectedWeapon) return;
  const res = await fetch(`/api/upgrade/${selectedWeapon.weapon_key}`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({ action: actionName, delta: 1 }),
  });
  const r = await res.json();
  toast(r.message ?? r.error, r.success !== false);
  if (r.success) await refreshUpgrade();
}

// ---- Toast ----

function toast(msg, ok) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${ok ? 'ok' : 'err'}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 4500);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Enchant ----

const CAT_LABELS_FULL = { defend: 'Defend', defend_crit: 'Defend Crit', attack: 'Attack', attack_crit: 'Attack Crit', special: 'Special', special_crit: 'Special Crit' };

let enchantData     = null;
let enchantWeapon   = null;
let enchantPending  = null; // { actionName, kind, category, subtype, delta }

async function loadEnchant() {
  const res = await fetch('/api/enchant', { headers: authHeaders() });
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
    opt.value = w.weapon_key;
    opt.textContent = `${w.name}${w.equipped ? ' (equipped)' : ''} — ${w.enchants_used}/${w.enchant_slots} enchants`;
    picker.appendChild(opt);
  }
  const prevKey = enchantWeapon?.weapon_key;
  enchantWeapon = enchantData.weapons.find(w => w.weapon_key === prevKey) ?? enchantData.weapons[0];
  picker.value = enchantWeapon.weapon_key;
  enchantPending = null;
  renderEnchantPanel();
}

function pickEnchantWeapon(key) {
  enchantWeapon = enchantData?.weapons.find(w => w.weapon_key === key) ?? null;
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

  // Determine which categories/kinds the player can do
  const availableKinds = {};
  for (const cat of enchantData.categories) {
    const kinds = [];
    for (const kind of ['minor', 'major']) {
      if (lvl >= enchantData.level_required[cat][kind]) kinds.push(kind);
    }
    if (kinds.length > 0) availableKinds[cat] = kinds;
  }

  let rowsHtml = '';
  for (const a of w.actions) {
    if (!a.upgradeable) continue;
    const enchanted = a.enchant;
    const editing   = enchantPending?.actionName === a.name;
    let detailHtml  = '';

    if (enchanted) {
      const deltaTxt = Array.isArray(enchanted.delta)
        ? `[${enchanted.delta.join(', ')}]`
        : `+${enchanted.delta}`;
      detailHtml = `<span class="enchant-tag">${esc(enchanted.category)} ${esc(enchanted.subtype)} ${enchanted.kind === 'major' ? '(major)' : ''} ${deltaTxt}</span>`;
    } else if (!slotsFull) {
      detailHtml = editing
        ? renderEnchantEditor(a)
        : `<button class="upg-btn" onclick="startEnchant('${esc(a.name)}')">Enchant</button>`;
    }

    rowsHtml += `<div class="upg-action${enchanted ? ' dim' : ''}">
      <span class="upg-name">${esc(a.name)}</span>
      <span class="upg-stat">${esc(a.damage_type)} ${esc(a.damage_subtype)}</span>
      ${detailHtml}
    </div>`;
  }

  panel.innerHTML = `
    <div class="upgrade-budget">
      <span class="budget-used">${w.enchants_used} / ${w.enchant_slots} enchants used</span>
      ${slotsFull ? '<span class="budget-cap">Slots full</span>' : ''}
    </div>
    ${rowsHtml}
  `;
}

function startEnchant(actionName) {
  const a = enchantWeapon.actions.find(x => x.name === actionName);
  if (!a) return;
  enchantPending = {
    actionName,
    kind: 'minor',
    category: 'physical',
    subtype: enchantData.subtypes.physical[0],
    delta: a.type === 'field' ? new Array(a.field_len).fill(0) : 1,
  };
  // For minor field actions, distribute 1 by default to first cell
  if (a.type === 'field') enchantPending.delta[0] = 1;
  renderEnchantPanel();
}

function cancelEnchant() {
  enchantPending = null;
  renderEnchantPanel();
}

function renderEnchantEditor(a) {
  const lvl = enchantData.enchanter_level;
  const p   = enchantPending;
  const targetDelta = p.kind === 'minor' ? 1 : 3;

  // Available categories for the chosen kind
  const cats = enchantData.categories.filter(c => lvl >= enchantData.level_required[c][p.kind]);

  // Kinds available
  const kinds = ['minor', 'major'].filter(k =>
    enchantData.categories.some(c => lvl >= enchantData.level_required[c][k])
  );

  const subs = enchantData.subtypes[p.category];
  const cost = p.kind === 'minor' ? enchantData.minor_cost : enchantData.major_cost;
  const canAfford = Object.entries(cost).every(([m, q]) => (enchantData.materials[m] ?? 0) >= q);
  const costStr = Object.entries(cost).map(([m, q]) => `${q} ${m}`).join(', ');

  let fieldHtml = '';
  if (a.type === 'field') {
    const spent = p.delta.reduce((s, v) => s + v, 0);
    const rem   = targetDelta - spent;
    let cells = '';
    for (let i = 0; i < p.delta.length; i++) {
      cells += `<div class="field-cell">
        <button class="field-btn" onclick="adjEnchantDelta(${i}, -1)" ${p.delta[i] <= 0 ? 'disabled' : ''}>−</button>
        <span class="field-val">+${p.delta[i]}</span>
        <button class="field-btn" onclick="adjEnchantDelta(${i}, 1)" ${rem <= 0 ? 'disabled' : ''}>+</button>
      </div>`;
    }
    fieldHtml = `<div class="enchant-field">
      <p class="enchant-distribute">Distribute +${targetDelta} (${rem} remaining)</p>
      <div class="field-cells">${cells}</div>
    </div>`;
  }

  const sumOk = a.type === 'field'
    ? p.delta.reduce((s, v) => s + v, 0) === targetDelta
    : true;

  return `<div class="enchant-editor">
    <div class="enchant-row">
      <label>Kind:</label>
      <select onchange="setEnchantKind(this.value)">
        ${kinds.map(k => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${k}</option>`).join('')}
      </select>
      <label>Category:</label>
      <select onchange="setEnchantCategory(this.value)">
        ${cats.map(c => `<option value="${c}" ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <label>Subtype:</label>
      <select onchange="setEnchantSubtype(this.value)">
        ${subs.map(s => `<option value="${s}" ${s === p.subtype ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    ${fieldHtml}
    <p class="enchant-cost ${canAfford ? '' : 'cant-afford'}">Cost: ${costStr}</p>
    <div class="enchant-actions">
      <button class="upg-btn" onclick="confirmEnchant()" ${(!canAfford || !sumOk) ? 'disabled' : ''}>Apply Enchant</button>
      <button class="upg-btn-cancel" onclick="cancelEnchant()">Cancel</button>
    </div>
  </div>`;
}

function setEnchantKind(k) {
  if (!enchantPending) return;
  enchantPending.kind = k;
  const a = enchantWeapon.actions.find(x => x.name === enchantPending.actionName);
  const target = k === 'minor' ? 1 : 3;
  if (a.type === 'field') {
    enchantPending.delta = new Array(a.field_len).fill(0);
    enchantPending.delta[0] = target;
  } else {
    enchantPending.delta = target;
  }
  // Ensure category still valid
  const lvl = enchantData.enchanter_level;
  if (lvl < enchantData.level_required[enchantPending.category][k]) {
    enchantPending.category = enchantData.categories.find(c => lvl >= enchantData.level_required[c][k]) ?? enchantPending.category;
    enchantPending.subtype  = enchantData.subtypes[enchantPending.category][0];
  }
  renderEnchantPanel();
}

function setEnchantCategory(c) {
  if (!enchantPending) return;
  enchantPending.category = c;
  enchantPending.subtype  = enchantData.subtypes[c][0];
  renderEnchantPanel();
}

function setEnchantSubtype(s) {
  if (!enchantPending) return;
  enchantPending.subtype = s;
  renderEnchantPanel();
}

function adjEnchantDelta(i, dir) {
  if (!enchantPending || !Array.isArray(enchantPending.delta)) return;
  const target = enchantPending.kind === 'minor' ? 1 : 3;
  const spent  = enchantPending.delta.reduce((s, v) => s + v, 0);
  if (dir > 0 && spent >= target) return;
  if (dir < 0 && enchantPending.delta[i] <= 0) return;
  enchantPending.delta[i] += dir;
  renderEnchantPanel();
}

async function confirmEnchant() {
  if (!enchantPending || !enchantWeapon) return;
  const res = await fetch(`/api/enchant/${enchantWeapon.weapon_key}`, {
    method: 'POST', headers: authHeaders(true),
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
    await loadEnchant();
  }
}

load();
