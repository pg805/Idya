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
              <label for="settings-quick" class="layout-settings-label">Quick actions</label>
              <input id="settings-quick" type="checkbox" class="layout-settings-toggle">
            </div>
            <p class="layout-settings-help">In combat, actions fire the instant you pick them (one click). Off lets you review and Confirm before committing your turn.</p>
            <div class="layout-settings-row">
              <a class="layout-settings-link" href="/app/account">Account and settings</a>
            </div>
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
  renderVerifyBanner();
}

/**
 * Nag about an unconfirmed address, without blocking anything.
 *
 * Deliberately a banner rather than a gate: signing up happens in front of the
 * GM during a session, and making someone go find their inbox before they can
 * play is the worst possible first five minutes. What being unverified costs
 * you is account recovery, and the banner says so.
 */
async function renderVerifyBanner() {
  // Sits above #app-shell, not inside it. The shell is a flex row holding the
  // sidebar and the content, so anything appended there becomes a third column.
  const shell = document.getElementById('app-shell');
  if (!shell || !layoutData?.authenticated) return;

  let methods;
  try {
    const res = await fetch('/api/auth/methods', { credentials: 'same-origin' });
    if (!res.ok) return;
    methods = await res.json();
  } catch (_) { return; }

  const existing = document.querySelector('.verify-banner');
  if (!methods.email || methods.email.verified) { existing?.remove(); return; }
  if (existing) return;
  if (verifyBannerSnoozed()) return;

  const el = document.createElement('div');
  el.className = 'verify-banner';
  el.innerHTML = `
    <div class="verify-banner-text">
      <strong>Confirm your email address.</strong>
      <span>Until you do, there's no way to get back into your account if you lose your password.</span>
    </div>
    <div class="verify-banner-actions">
      <a class="verify-banner-btn" href="/app/account" data-path="/account">Confirm now</a>
      <button class="verify-banner-close" type="button" aria-label="Dismiss">&times;</button>
    </div>`;

  el.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    window.navigate?.('/account');
  });
  el.querySelector('.verify-banner-close').addEventListener('click', () => {
    snoozeVerifyBanner();
    el.remove();
  });

  shell.parentNode.insertBefore(el, shell);
}

// Dismissing snoozes rather than silences. This is the only prompt to confirm
// an address, and an account nobody can recover is a worse outcome than a
// banner somebody sees again tomorrow.
const VERIFY_SNOOZE_KEY = 'idya_verify_snoozed_until';
const VERIFY_SNOOZE_MS = 24 * 60 * 60 * 1000;

function verifyBannerSnoozed() {
  try {
    const until = Number(localStorage.getItem(VERIFY_SNOOZE_KEY) || 0);
    return Number.isFinite(until) && Date.now() < until;
  } catch (_) {
    return false; // private mode, no storage: show it.
  }
}

function snoozeVerifyBanner() {
  try {
    localStorage.setItem(VERIFY_SNOOZE_KEY, String(Date.now() + VERIFY_SNOOZE_MS));
  } catch (_) { /* nothing to do; it just shows again */ }
}

/**
 * The header popover.
 *
 * Deliberately thin. Everything that isn't needed mid-fight lives on the
 * account page instead; this keeps the one combat preference, because the
 * battle screen renders this same header and leaving a fight to change how
 * actions commit would be absurd.
 */
async function wireSettingsPopover() {
  const btn = document.querySelector('.layout-settings-btn');
  const pop = document.querySelector('.layout-settings-pop');
  if (!btn || !pop) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', (e) => {
    if (pop.hidden) return;
    if (!pop.contains(e.target) && e.target !== btn) pop.hidden = true;
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
