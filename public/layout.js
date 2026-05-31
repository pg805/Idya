// Shared header layout — persistent across navigation.

const PROF_SHOP_LAYOUT = { lumberjack: 'lumberjack', blacksmith: 'blacksmith', enchanter: 'enchanting_shop' };

function layoutEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let layoutTitle = '';
let layoutData  = null;

// Update just the title bar text (no fetch).
function setLayoutTitle(title) {
  layoutTitle = title;
  const el = document.querySelector('.layout-title');
  if (el) el.textContent = title;
}

// Fetch fresh data and re-render the header.
async function mountLayout({ title } = {}) {
  if (title !== undefined) layoutTitle = title;
  try {
    const res = await fetch('/api/layout');
    if (res.ok) layoutData = await res.json();
  } catch (_) {}
  renderLayout();
  window.dispatchEvent(new CustomEvent('layout-changed'));
}

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

  const profCards = Object.entries(layoutData.professions).map(([key, p]) => {
    const pct       = (p.level / p.maxLevel) * 100;
    const atMax     = p.level >= p.maxLevel;
    const canAfford = p.nextCost != null && layoutData.korel >= p.nextCost;
    const cost      = p.nextCost != null ? p.nextCost.toLocaleString() : null;
    return `<div class="layout-prof">
      <p class="layout-prof-name">${layoutEsc(p.label)}</p>
      <p class="layout-prof-level">${p.level}<span> / ${p.maxLevel}</span></p>
      <div class="layout-prof-bar-bg"><div class="layout-prof-bar" style="width:${pct}%"></div></div>
      <div class="layout-prof-footer">
        <p class="layout-prof-meta">${atMax ? 'Mastered' : cost != null ? `Next: ${cost} korel` : 'Cap'}</p>
        ${!atMax && cost != null
          ? `<button class="layout-train-btn" onclick="layoutTrain('${PROF_SHOP_LAYOUT[key]}')" ${canAfford ? '' : 'disabled'}>Train</button>`
          : ''}
      </div>
    </div>`;
  }).join('');

  root.innerHTML = `
    <header class="layout-header">
      <div class="layout-title-bar">
        <h1 class="layout-title">${layoutEsc(layoutTitle)}</h1>
        <span class="layout-char-name">${layoutEsc(layoutData.characterName)}</span>
        <span class="layout-korel">${layoutData.korel.toLocaleString()} korel</span>
      </div>
      <div class="layout-prof-row">
        <div class="layout-sprite">
          ${spriteUrl ? `<img src="${spriteUrl}" alt="${layoutEsc(layoutData.characterName)}">` : ''}
        </div>
        <div class="layout-prof-cards">${profCards}</div>
      </div>
    </header>`;
}

async function layoutTrain(shopKey) {
  const res = await fetch(`/api/shop/${shopKey}/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  if (window.showToast) window.showToast(body.message ?? body.error ?? 'Error');
  else alert(body.message ?? body.error ?? 'Error');
  if (body.success) await mountLayout();
}
