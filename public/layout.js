// Shared header layout — persistent across navigation.

function layoutEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let layoutTitle = '';
let layoutData  = null;
// Compact header: drop the sprite + profession bars (the tall row). Set by the
// battle page so the combat view isn't pushed down by header it doesn't need.
let layoutCompact = false;

// Update just the title bar text (no fetch).
function setLayoutTitle(title) {
  layoutTitle = title;
  const el = document.querySelector('.layout-title');
  if (el) el.textContent = title;
}

// Fetch fresh data and re-render the header.
async function mountLayout({ title, compact } = {}) {
  if (title !== undefined) layoutTitle = title;
  if (compact !== undefined) layoutCompact = compact;
  try {
    const res = await fetch('/api/layout');
    if (res.ok) layoutData = await res.json();
  } catch (_) {}
  renderLayout();
  // Reveal the dev-only sidebar group once we know who's logged in.
  const devGroup = document.querySelector('.nav-group-dev');
  if (devGroup) devGroup.hidden = !layoutData?.is_dev;
  window.dispatchEvent(new CustomEvent('layout-changed'));
}

function getLayoutData() { return layoutData; }
window.getLayoutData = getLayoutData;

function renderLayout() {
  const root = document.getElementById('layout-root');
  if (!root) return;

  if (!layoutData?.authenticated) {
    root.innerHTML = `
      <header class="layout-header">
        <div class="layout-title-bar">
          <h1 class="layout-title">${layoutEsc(layoutTitle)}</h1>
        </div>
      </header>`;
    return;
  }

  const spriteUrl = layoutData.spriteToken ? `${layoutData.spriteCdn}/${layoutData.spriteToken}.png` : null;

  const profCards = Object.entries(layoutData.professions).map(([_key, p]) => {
    const pct   = (p.level / p.maxLevel) * 100;
    const atMax = p.level >= p.maxLevel;
    const cost  = p.nextCost != null ? p.nextCost.toLocaleString() : null;
    return `<div class="layout-prof">
      <p class="layout-prof-name">${layoutEsc(p.label)}</p>
      <p class="layout-prof-level">${p.level}<span> / ${p.maxLevel}</span></p>
      <div class="layout-prof-bar-bg"><div class="layout-prof-bar" style="width:${pct}%"></div></div>
      <p class="layout-prof-meta">${atMax ? 'Mastered' : cost != null ? `Next: ${cost} korel` : 'Cap'}</p>
    </div>`;
  }).join('');

  root.innerHTML = `
    <header class="layout-header">
      <div class="layout-title-bar">
        <h1 class="layout-title">${layoutEsc(layoutTitle)}</h1>
        <span class="layout-char-name">${layoutEsc(layoutData.characterName)}</span>
        <div class="layout-right">
          <span class="layout-korel">${layoutData.korel.toLocaleString()} korel</span>
          <button class="layout-settings-btn" type="button" aria-label="Settings" title="Settings">⚙</button>
          <div class="layout-settings-pop" hidden>
            <div class="layout-settings-row">
              <label for="settings-ping" class="layout-settings-label">Ping on action</label>
              <input id="settings-ping" type="checkbox" class="layout-settings-toggle">
            </div>
            <p class="layout-settings-help">When on, Discord posts that mention you (battles, shops, crafts) ping you. Off uses your character name instead.</p>
            <div class="layout-settings-row">
              <label for="settings-quick" class="layout-settings-label">Quick actions</label>
              <input id="settings-quick" type="checkbox" class="layout-settings-toggle">
            </div>
            <p class="layout-settings-help">In combat, actions fire the instant you pick them (one click). Off lets you review and Confirm before committing your turn.</p>
          </div>
        </div>
      </div>
      ${layoutCompact ? '' : `<div class="layout-prof-row">
        <div class="layout-sprite">
          ${spriteUrl ? `<img src="${spriteUrl}" alt="${layoutEsc(layoutData.characterName)}">` : ''}
        </div>
        <div class="layout-prof-cards">${profCards}</div>
      </div>`}
    </header>`;

  wireSettingsPopover();
}

async function wireSettingsPopover() {
  const btn = document.querySelector('.layout-settings-btn');
  const pop = document.querySelector('.layout-settings-pop');
  const toggle = document.getElementById('settings-ping');
  if (!btn || !pop || !toggle) return;

  // Pre-populate from server. If the fetch fails the toggle stays at the
  // checked=false default, which matches the column default.
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      toggle.checked = !!data.ping_on_action;
    }
  } catch (_) {}

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', (e) => {
    if (pop.hidden) return;
    if (!pop.contains(e.target) && e.target !== btn) pop.hidden = true;
  });

  toggle.addEventListener('change', async () => {
    const ping_on_action = toggle.checked;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping_on_action }),
    }).catch(() => {});
  });

  // Quick actions — a client-side (per-device) combat preference read by game.js.
  const quickToggle = document.getElementById('settings-quick');
  if (quickToggle) {
    quickToggle.checked = localStorage.getItem('idya.battle_quick') === '1';
    quickToggle.addEventListener('change', () => {
      localStorage.setItem('idya.battle_quick', quickToggle.checked ? '1' : '0');
      window.dispatchEvent(new CustomEvent('commitmode-change'));
    });
  }
}


// ---- Shared quantity stepper ----
// Renders "− [editable] + ALL" and handles clamping, used by Crafting / Shop /
// Town Square. Reads data-min/data-max from the input; an optional onchange
// (a global handler path, e.g. "Views.shop.onQty") fires after every change so a
// view can react (the shop binds it to its cart). Extra data:{...} → data-* attrs.
window.QtyStepper = {
  html(o) {
    const id = o.id, value = o.value ?? 1, min = o.min ?? 1, max = o.max ?? 0;
    const all = o.all !== false, dis = o.disabled ? 'disabled' : '';
    const oc  = o.onchange ? ` data-onchange="${o.onchange}"` : '';
    const ex  = o.data ? Object.entries(o.data).map(([k, v]) => ` data-${k}="${String(v).replace(/"/g, '&quot;')}"`).join('') : '';
    return `<div class="qty-ctrl${o.disabled ? ' disabled' : ''}">`
      + `<button type="button" class="qty-step" onclick="QtyStepper.adj('${id}',-1)" ${dis}>−</button>`
      + `<input class="qty-input" id="${id}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6"`
      + ` value="${value}" data-min="${min}" data-max="${max}"${oc}${ex} oninput="QtyStepper.clean('${id}')" ${dis}>`
      + `<button type="button" class="qty-step" onclick="QtyStepper.adj('${id}',1)" ${dis}>+</button>`
      + (all ? `<button type="button" class="qty-all" onclick="QtyStepper.set('${id}',${max})" ${dis}>ALL</button>` : '')
      + `</div>`;
  },
  _el(id) { return document.getElementById(id); },
  _fire(el) {
    const h = el.dataset.onchange; if (!h) return;
    const fn = h.split('.').reduce((o, k) => (o ? o[k] : undefined), window);
    if (typeof fn === 'function') fn(el.id);
  },
  set(id, v) {
    const el = this._el(id); if (!el) return;
    const min = parseInt(el.dataset.min, 10), max = parseInt(el.dataset.max, 10);
    let n = Math.floor(Number(v) || 0);
    if (!isNaN(min)) n = Math.max(min, n);
    if (!isNaN(max)) n = Math.min(max, n);
    el.value = String(n); this._fire(el);
  },
  adj(id, d) { const el = this._el(id); if (el) this.set(id, (parseInt(el.value, 10) || 0) + d); },
  // Retarget the cap (e.g. when a dropdown changes how many you own) and re-clamp.
  setMax(id, max) {
    const el = this._el(id); if (!el) return;
    el.dataset.max = String(max);
    const all = el.parentElement?.querySelector('.qty-all');
    if (all) all.setAttribute('onclick', `QtyStepper.set('${id}',${max})`);
    this.set(id, parseInt(el.value, 10) || 0);
  },
  clean(id) {
    const el = this._el(id); if (!el) return;
    const max = parseInt(el.dataset.max, 10);
    let n = parseInt(el.value.replace(/\D/g, ''), 10) || 0;   // allow empty/0 while typing
    if (!isNaN(max)) n = Math.min(max, n);
    if (String(n) !== el.value) el.value = String(n);
    this._fire(el);
  },
  val(id) { return parseInt(this._el(id)?.value, 10) || 0; },
};
