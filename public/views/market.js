// View: Market — public price overview across every shop.
// Shows current buy/sell, expected R-curve floor/ceiling, and time
// to the next price tick. Sortable, filterable by shop.
(function() {
  let rows = [];
  let sortKey = 'shop_id';
  let sortDir = 'asc';
  let shopFilter = null; // null = all shops
  let timerHandle = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtPrice(v) { return v == null ? '—' : String(v); }
  function fmtRange(min, max) {
    if (min == null || max == null) return '—';
    return `${min}–${max}`;
  }
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
      document.getElementById('mk-body').innerHTML = `<p class="mk-empty">Could not load market data.</p>`;
      return;
    }
    const data = await res.json();
    rows = data.items;
    render();
  }

  function sortedRows() {
    const out = rows.slice();
    if (shopFilter) out.splice(0, out.length, ...rows.filter(r => r.shop_id === shopFilter));
    const dir = sortDir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av < bv ? -1 : av > bv ? 1 : 0)) * dir;
    });
    return out;
  }

  function setSort(key) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = key; sortDir = 'asc'; }
    render();
  }

  function uniqueShops() {
    const seen = new Map();
    for (const r of rows) if (!seen.has(r.shop_id)) seen.set(r.shop_id, r.shop_name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }

  function thHtml(label, key, opts = {}) {
    const cls = sortKey === key ? `mk-th mk-th-active mk-th-${sortDir}` : 'mk-th';
    const align = opts.numeric ? ' mk-th-num' : '';
    return `<th class="${cls}${align}" data-sort="${key}" title="${esc(opts.title ?? '')}">${esc(label)}</th>`;
  }

  function render() {
    const body = document.getElementById('mk-body');
    if (!body) return;

    const shopChips = ['<button class="mk-chip ' + (shopFilter == null ? 'mk-chip-on' : '') + '" data-shop="">All</button>']
      .concat(uniqueShops().map(s => `<button class="mk-chip ${shopFilter === s.id ? 'mk-chip-on' : ''}" data-shop="${esc(s.id)}">${esc(s.name)}</button>`))
      .join('');

    const rowsHtml = sortedRows().map(r => `
      <tr>
        <td>${esc(r.shop_name)}</td>
        <td>${esc(r.item_name)} ${r.source === 'recipe' ? '<span class="mk-tag">crafted</span>' : ''}</td>
        <td class="mk-num">${fmtPrice(r.current_buy)}</td>
        <td class="mk-num mk-range">${fmtRange(r.min_expected_buy, r.max_expected_buy)}</td>
        <td class="mk-num">${fmtPrice(r.current_sell)}</td>
        <td class="mk-num mk-range">${fmtRange(r.min_expected_sell, r.max_expected_sell)}</td>
        <td class="mk-num">${fmtCountdown(r.seconds_to_next_tick)}</td>
      </tr>
    `).join('');

    body.innerHTML = `
      <header class="mk-head">
        <h1 class="mk-title">Market</h1>
        <p class="mk-sub">Live prices across every shop. Expected ranges are the floor and ceiling the R curve naturally settles between — actual prices can briefly drift outside these on heavy trading.</p>
      </header>
      <div class="mk-filters">${shopChips}</div>
      <div class="mk-table-wrap">
        <table class="mk-table">
          <thead><tr>
            ${thHtml('Shop', 'shop_name')}
            ${thHtml('Item', 'item_name')}
            ${thHtml('Buy', 'current_buy', { numeric: true, title: 'Current buy price' })}
            ${thHtml('Buy range', 'min_expected_buy', { numeric: true, title: 'Expected buy range (R-curve floor to ceiling)' })}
            ${thHtml('Sell', 'current_sell', { numeric: true, title: 'Current sell price' })}
            ${thHtml('Sell range', 'min_expected_sell', { numeric: true, title: 'Expected sell range (R-curve floor to ceiling)' })}
            ${thHtml('Next tick', 'seconds_to_next_tick', { numeric: true, title: 'Time until the next daily price tick' })}
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;

    body.querySelectorAll('.mk-th').forEach(th => {
      th.addEventListener('click', () => setSort(th.dataset.sort));
    });
    body.querySelectorAll('.mk-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        shopFilter = btn.dataset.shop === '' ? null : btn.dataset.shop;
        render();
      });
    });
  }

  async function mount(root) {
    setLayoutTitle('Market');
    root.innerHTML = `<div id="mk-body"><p class="mk-empty">Loading…</p></div>`;
    await loadData();
    // Live-tick the countdown every second so players can see the next tick approach.
    timerHandle = setInterval(() => {
      for (const r of rows) {
        if (r.seconds_to_next_tick != null) r.seconds_to_next_tick = Math.max(0, r.seconds_to_next_tick - 1);
      }
      // Just re-render countdown cells in place to avoid full DOM rebuild.
      const cells = document.querySelectorAll('.mk-table tbody tr');
      const sorted = sortedRows();
      cells.forEach((tr, i) => {
        const td = tr.children[6];
        if (td && sorted[i]) td.textContent = fmtCountdown(sorted[i].seconds_to_next_tick);
      });
    }, 1000);
  }

  function unmount() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    rows = [];
    shopFilter = null;
  }

  window.Views = window.Views ?? {};
  window.Views.market = { mount, unmount };
})();
