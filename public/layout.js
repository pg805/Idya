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

