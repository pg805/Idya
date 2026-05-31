// Shared header layout — mountLayout({ title }) injects the top bar into #layout-root.

const PROF_SHOP_LAYOUT = { lumberjack: 'lumberjack', blacksmith: 'blacksmith', enchanter: 'enchanting_shop' };

function layoutEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function layoutGetToken() {
  return localStorage.getItem('shop_auth') ?? '';
}

async function mountLayout({ title }) {
  const root = document.getElementById('layout-root');
  if (!root) return null;

  const token = layoutGetToken();
  let data = null;
  try {
    const res = await fetch('/api/layout', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) data = await res.json();
  } catch (_) {}

  if (!data?.authenticated) {
    root.innerHTML = `
      <header class="layout-header">
        <div class="layout-title-bar">
          <h1 class="layout-title">${layoutEsc(title)}</h1>
        </div>
      </header>`;
    return null;
  }

  const spriteUrl = data.spriteToken ? `${data.spriteCdn}/${data.spriteToken}.png` : null;

  const profCards = Object.entries(data.professions).map(([key, p]) => {
    const pct       = (p.level / p.maxLevel) * 100;
    const atMax     = p.level >= p.maxLevel;
    const canAfford = p.nextCost != null && data.korel >= p.nextCost;
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
        <h1 class="layout-title">${layoutEsc(title)}</h1>
        <span class="layout-char-name">${layoutEsc(data.characterName)}</span>
        <span class="layout-korel">${data.korel.toLocaleString()} korel</span>
      </div>
      <div class="layout-prof-row">
        <div class="layout-sprite">
          ${spriteUrl ? `<img src="${spriteUrl}" alt="${layoutEsc(data.characterName)}">` : ''}
        </div>
        <div class="layout-prof-cards">${profCards}</div>
      </div>
    </header>`;

  return data;
}

async function layoutTrain(shopKey) {
  const token = layoutGetToken();
  const res = await fetch(`/api/shop/${shopKey}/train`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  if (window.showToast) window.showToast(body.message ?? body.error ?? 'Error');
  else alert(body.message ?? body.error ?? 'Error');
  if (body.success) {
    if (window.onLayoutChange) await window.onLayoutChange();
    else await mountLayout({ title: document.querySelector('.layout-title')?.textContent ?? '' });
  }
}
