// View: Market — public price overview across every shop.
// Cards-per-shop, with separate commodities and valuables sub-sections.
// Commodities frame their range as "current → hot" (price sits at the
// floor under normal trading, climbs with demand). Valuables frame as
// "low → high" (price floats inside a broader band).
(function() {
  let rows = [];
  let categoryFilter = 'all'; // 'all' | 'commodity' | 'valuable'
  let timerHandle = null;

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

  function rowsByShop(category) {
    const filtered = category === 'all' ? rows : rows.filter(r => r.category === category);
    const byShop = new Map();
    for (const r of filtered) {
      if (!byShop.has(r.shop_id)) byShop.set(r.shop_id, { name: r.shop_name, items: [] });
      byShop.get(r.shop_id).items.push(r);
    }
    // Sort items inside each shop by name.
    for (const shop of byShop.values()) {
      shop.items.sort((a, b) => a.item_name.localeCompare(b.item_name));
    }
    return byShop;
  }

  function commodityRowsHtml(items) {
    if (items.length === 0) return '';
    const trs = items.map(r => `
      <tr>
        <td>${esc(r.item_name)}${r.source === 'recipe' ? '<span class="mk-tag">crafted</span>' : ''}</td>
        <td class="mk-num">${fmtPrice(r.current_buy)} → <span class="mk-hi">${fmtPrice(r.max_expected_buy)}</span></td>
        <td class="mk-num">${fmtPrice(r.current_sell)} → <span class="mk-hi">${fmtPrice(r.max_expected_sell)}</span></td>
        <td class="mk-num mk-countdown" data-seconds="${r.seconds_to_next_tick ?? ''}">${fmtCountdown(r.seconds_to_next_tick)}</td>
      </tr>
    `).join('');
    return `
      <h4 class="mk-sub">Commodities <span class="mk-hint">(current price → hot-demand ceiling)</span></h4>
      <table class="mk-table">
        <thead><tr>
          <th>Item</th>
          <th class="mk-th-num">Buy</th>
          <th class="mk-th-num">Sell</th>
          <th class="mk-th-num">Next tick</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
  }

  function valuableRowsHtml(items) {
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
      <h4 class="mk-sub">Valuables <span class="mk-hint">(low ↔ high range)</span></h4>
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
        ${commodities.length > 0 ? commodityRowsHtml(commodities) : ''}
        ${valuables.length > 0 ? valuableRowsHtml(valuables) : ''}
      </section>`;
  }

  function render() {
    const root = document.getElementById('mk-root');
    if (!root) return;

    const filterChips = ['all', 'commodity', 'valuable']
      .map(c => `<button class="mk-chip ${categoryFilter === c ? 'mk-chip-on' : ''}" data-cat="${c}">${c === 'all' ? 'All' : c === 'commodity' ? 'Commodities' : 'Valuables'}</button>`)
      .join('');

    const byShop = rowsByShop(categoryFilter);
    const cards = [...byShop.values()].map(shopCardHtml).join('');

    root.innerHTML = `
      <header class="mk-head">
        <h1 class="mk-title">Market</h1>
        <p class="mk-sub-line">Live prices across every shop. Commodities track the resting price and the ceiling demand can push them to. Valuables float in a low–high band.</p>
      </header>
      <div class="mk-filters">
        <div class="mk-filter-row"><span class="mk-filter-label">Show</span><div class="mk-chips">${filterChips}</div></div>
      </div>
      <div class="mk-shops">${cards || '<p class="mk-empty">No items in this filter.</p>'}</div>
    `;

    root.querySelectorAll('.mk-chip').forEach(btn => {
      btn.addEventListener('click', () => { categoryFilter = btn.dataset.cat; render(); });
    });
  }

  async function mount(rootEl) {
    setLayoutTitle('Market');
    rootEl.innerHTML = `<div id="mk-root" class="mk-page"><p class="mk-empty">Loading…</p></div>`;
    await loadData();
    // Tick the countdown cells in place every second without rebuilding the DOM.
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
    categoryFilter = 'all';
  }

  window.Views = window.Views ?? {};
  window.Views.market = { mount, unmount };
})();
