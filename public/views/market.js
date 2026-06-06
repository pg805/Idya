// View: Market — public price overview across every shop.
// Cards-per-shop, with separate commodities and valuables sub-sections.
// Commodities frame their range as "current vs hot demand ceiling".
// Valuables frame as "low ↔ high band" (current floats inside).
(function() {
  let rows = [];
  // null = nothing filtered (all selected). Set = explicit selection.
  // Matches the multi-select chip pattern from the dev stats page.
  let selected = { shops: null, categories: null };
  let timerHandle = null;

  // Mirror the order shops appear in the sidebar so cards line up with
  // navigation. Shops not in the list fall to the end alphabetically.
  const SHOP_ORDER = ['general_store', 'blacksmith', 'lumberjack', 'enchanting_shop', 'temple'];
  function shopRank(shopId) {
    const i = SHOP_ORDER.indexOf(shopId);
    return i === -1 ? SHOP_ORDER.length : i;
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtPrice(v) { return v == null ? '—' : String(v); }
  function fmtCountdown(seconds) {
    if (seconds == null) return '—';
    if (seconds <= 0) return 'due now';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function availableShops() {
    const seen = new Map();
    for (const r of rows) if (!seen.has(r.shop_id)) seen.set(r.shop_id, r.shop_name);
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => shopRank(a.id) - shopRank(b.id));
  }
  const CATEGORIES = [
    { id: 'commodity', name: 'Commodities' },
    { id: 'valuable',  name: 'Valuables'   },
  ];

  function isActive(key, value) {
    if (selected[key] === null) return true;
    return selected[key].has(value);
  }

  function toggleInSet(key, value, allValues) {
    if (selected[key] === null) {
      selected[key] = new Set(allValues);
    }
    if (selected[key].has(value)) selected[key].delete(value);
    else                          selected[key].add(value);
    // If the user re-selected everything, drop to null so the URL/state stays clean.
    if (allValues.every(v => selected[key].has(v))) selected[key] = null;
    render();
  }

  function filteredRows() {
    return rows.filter(r => {
      if (selected.shops      && !selected.shops.has(r.shop_id))     return false;
      if (selected.categories && !selected.categories.has(r.category)) return false;
      return true;
    });
  }

  function shopsInOrder() {
    const filtered = filteredRows();
    const byShop = new Map();
    for (const r of filtered) {
      if (!byShop.has(r.shop_id)) byShop.set(r.shop_id, { id: r.shop_id, name: r.shop_name, items: [] });
      byShop.get(r.shop_id).items.push(r);
    }
    for (const shop of byShop.values()) {
      shop.items.sort((a, b) => a.item_name.localeCompare(b.item_name));
    }
    return [...byShop.values()].sort((a, b) => shopRank(a.id) - shopRank(b.id));
  }

  async function loadData() {
    const res = await fetch('/api/info/market');
    if (!res.ok) {
      document.getElementById('mk-root').innerHTML = `<p class="mk-empty">Could not load market data.</p>`;
      return;
    }
    const data = await res.json();
    rows = data.items;
    render();
  }

  function itemsTableHtml(items, label) {
    if (items.length === 0) return '';
    const trs = items.map(r => `
      <tr>
        <td>${esc(r.item_name)}${r.source === 'recipe' ? '<span class="mk-tag">crafted</span>' : ''}</td>
        <td class="mk-num">${fmtPrice(r.current_buy)}</td>
        <td class="mk-num mk-range">${fmtPrice(r.min_expected_buy)} – ${fmtPrice(r.max_expected_buy)}</td>
        <td class="mk-num">${fmtPrice(r.current_sell)}</td>
        <td class="mk-num mk-range">${fmtPrice(r.min_expected_sell)} – ${fmtPrice(r.max_expected_sell)}</td>
        <td class="mk-num mk-countdown" data-seconds="${r.seconds_to_next_tick ?? ''}">${fmtCountdown(r.seconds_to_next_tick)}</td>
      </tr>
    `).join('');
    return `
      <h4 class="mk-sub">${label}</h4>
      <table class="mk-table">
        <thead><tr>
          <th>Item</th>
          <th class="mk-th-num">Buy</th>
          <th class="mk-th-num">Buy range</th>
          <th class="mk-th-num">Sell</th>
          <th class="mk-th-num">Sell range</th>
          <th class="mk-th-num">Next tick</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
  }

  function shopCardHtml(shop) {
    const commodities = shop.items.filter(r => r.category === 'commodity');
    const valuables   = shop.items.filter(r => r.category === 'valuable');
    return `
      <section class="mk-shop-card">
        <header>
          <h3>${esc(shop.name)}</h3>
          <span class="mk-shop-meta">${shop.items.length} item${shop.items.length === 1 ? '' : 's'}</span>
        </header>
        ${itemsTableHtml(commodities, 'Commodities')}
        ${itemsTableHtml(valuables,   'Valuables')}
      </section>`;
  }

  function chipsHtml(key, items) {
    return items.map(item => {
      const active = isActive(key, item.id);
      return `<button class="mk-chip ${active ? 'mk-chip-on' : ''}" data-key="${key}" data-value="${esc(item.id)}">${esc(item.name)}</button>`;
    }).join('');
  }

  function render() {
    const root = document.getElementById('mk-root');
    if (!root) return;

    const shops = availableShops();
    const cards = shopsInOrder().map(shopCardHtml).join('');

    root.innerHTML = `
      <header class="mk-head">
        <h1 class="mk-title">Market</h1>
        <p class="mk-sub-line">Live prices across every shop. The buy/sell ranges show where each item can naturally swing during regular trading — actual prices can briefly drift outside on heavy trading.</p>
      </header>
      <div class="mk-filters">
        <div class="mk-filter-row"><span class="mk-filter-label">Shops</span><div class="mk-chips">${chipsHtml('shops', shops)}</div></div>
        <div class="mk-filter-row"><span class="mk-filter-label">Categories</span><div class="mk-chips">${chipsHtml('categories', CATEGORIES)}</div></div>
      </div>
      <div class="mk-shops">${cards || '<p class="mk-empty">Nothing matches the current filters.</p>'}</div>
    `;

    root.querySelectorAll('.mk-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const allValues = (key === 'shops' ? shops : CATEGORIES).map(x => x.id);
        toggleInSet(key, btn.dataset.value, allValues);
      });
    });
  }

  async function mount(rootEl) {
    setLayoutTitle('Market');
    rootEl.innerHTML = `<div id="mk-root" class="mk-page"><p class="mk-empty">Loading…</p></div>`;
    await loadData();
    // Tick countdown cells in place every second so the rest of the DOM doesn't churn.
    timerHandle = setInterval(() => {
      document.querySelectorAll('.mk-countdown').forEach(td => {
        const s = parseInt(td.dataset.seconds, 10);
        if (Number.isFinite(s)) {
          const next = Math.max(0, s - 1);
          td.dataset.seconds = String(next);
          td.textContent = fmtCountdown(next);
        }
      });
    }, 1000);
  }

  function unmount() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    rows = [];
    selected = { shops: null, categories: null };
  }

  window.Views = window.Views ?? {};
  window.Views.market = { mount, unmount };
})();
