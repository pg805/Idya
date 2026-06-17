// View: Dev Price History — replays ShopPriceTick through the live pricing math
// (/api/dev/price-history) and charts the demand "waves". Reuses the Market
// page's Shops + Categories chip selections. Two modes: a small-multiples grid
// (one mini wave per item, grouped into per-shop cards like Market) and an
// overlaid comparison chart (one normalized line per selected item). Dev-only.
(function() {
  let data = null;                 // { days, shops, series }
  let selected = { shops: null, categories: null }; // null = all
  let days = 7;
  let mode = 'grid';               // 'grid' | 'overlay'
  let root = null;

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const q = (sel) => root.querySelector(sel);

  // Mirror the Market page's shop ordering so cards line up with the sidebar.
  const SHOP_ORDER = ['general_store', 'blacksmith', 'lumberjack', 'enchanting_shop', 'temple'];
  const shopRank = (id) => { const i = SHOP_ORDER.indexOf(id); return i === -1 ? SHOP_ORDER.length : i; };
  const CATEGORIES = [{ id: 'commodity', name: 'Commodities' }, { id: 'valuable', name: 'Valuables' }];
  const COLORS = ['#4fa3ff', '#ffb14f', '#ff5d6c', '#7fdc8f', '#c89bff', '#5fd0d0', '#e89bd0', '#b0c060'];

  function isActive(key, value) {
    if (selected[key] === null) return true;
    return selected[key].has(value);
  }
  function toggleInSet(key, value, allValues) {
    if (selected[key] === null) selected[key] = new Set(allValues);
    if (selected[key].has(value)) selected[key].delete(value);
    else                          selected[key].add(value);
    if (allValues.every(v => selected[key].has(v))) selected[key] = null;
    render();
  }
  function filteredSeries() {
    return data.series.filter(s => {
      if (selected.shops      && !selected.shops.has(s.shop_id))    return false;
      if (selected.categories && !selected.categories.has(s.category)) return false;
      return s.points.length > 0;
    });
  }
  function availableShops() {
    return [...data.shops].sort((a, b) => shopRank(a.id) - shopRank(b.id));
  }

  // ---- chart helpers ----
  // Build an SVG polyline points string from data points, given an accessor and
  // the x/y domains. Skips null values (breaks the line into segments).
  function polylines(points, accessor, t0, t1, lo, hi, W, H, pad) {
    const xspan = (t1 - t0) || 1, yspan = (hi - lo) || 1;
    const xAt = (t) => pad + ((t - t0) / xspan) * (W - 2 * pad);
    const yAt = (v) => pad + (1 - (v - lo) / yspan) * (H - 2 * pad);
    const segs = [];
    let cur = [];
    for (const p of points) {
      const v = accessor(p);
      if (v == null) { if (cur.length) segs.push(cur); cur = []; continue; }
      cur.push(`${xAt(p.t).toFixed(1)},${yAt(v).toFixed(1)}`);
    }
    if (cur.length) segs.push(cur);
    return segs.map(s => s.join(' '));
  }

  function miniChart(s) {
    const W = 280, H = 76, pad = 6;
    const vals = [];
    for (const p of s.points) { if (p.buy != null) vals.push(p.buy); if (p.sell != null) vals.push(p.sell); }
    if (vals.length < 2) return `<div class="ph-mini-empty">not enough data</div>`;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const t0 = s.points[0].t, t1 = s.points[s.points.length - 1].t;
    const sellSegs = polylines(s.points, (p) => p.sell, t0, t1, lo, hi, W, H, pad);
    const buySegs  = polylines(s.points, (p) => p.buy,  t0, t1, lo, hi, W, H, pad);
    const lines = [
      ...buySegs.map(pts  => `<polyline points="${pts}" fill="none" stroke="#5b6b85" stroke-width="1" opacity="0.6"/>`),
      ...sellSegs.map(pts => `<polyline points="${pts}" fill="none" stroke="#4fa3ff" stroke-width="1.5"/>`),
    ].join('');
    return `<svg class="ph-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lines}</svg>`;
  }

  function cur(s, key) {
    for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i][key] != null) return s.points[i][key];
    return null;
  }
  function rangeOf(s, key) {
    const vs = s.points.map(p => p[key]).filter(v => v != null);
    return vs.length ? [Math.min(...vs), Math.max(...vs)] : [null, null];
  }

  function itemBlock(s) {
    const [sl, sh] = rangeOf(s, 'sell');
    const nowSell = cur(s, 'sell');
    return `
      <div class="ph-item">
        <div class="ph-item-head">
          <span class="ph-item-name">${esc(s.item_name)}${s.source === 'recipe' ? '<span class="ph-tag">crafted</span>' : ''}</span>
          <span class="ph-item-now">sell ${nowSell ?? '—'}<span class="ph-range">${sl == null ? '' : ` · ${sl}–${sh}`}</span></span>
        </div>
        ${miniChart(s)}
      </div>`;
  }

  function gridHtml() {
    const filtered = filteredSeries();
    if (!filtered.length) return `<p class="ph-empty">Nothing matches the current filters.</p>`;
    const byShop = new Map();
    for (const s of filtered) {
      if (!byShop.has(s.shop_id)) byShop.set(s.shop_id, { id: s.shop_id, name: s.shop_name, items: [] });
      byShop.get(s.shop_id).items.push(s);
    }
    const shops = [...byShop.values()].sort((a, b) => shopRank(a.id) - shopRank(b.id));
    return shops.map(shop => {
      shop.items.sort((a, b) => a.item_name.localeCompare(b.item_name));
      return `
        <section class="ph-shop-card">
          <header><h3>${esc(shop.name)}</h3><span class="ph-shop-meta">${shop.items.length} item${shop.items.length === 1 ? '' : 's'}</span></header>
          <div class="ph-grid">${shop.items.map(itemBlock).join('')}</div>
        </section>`;
    }).join('');
  }

  // Overlay: every selected item on one axis, each normalized to its first
  // sell price (start = 1.0×) so wave shape is comparable across price tiers.
  function overlayHtml() {
    const filtered = filteredSeries();
    if (!filtered.length) return `<p class="ph-empty">Nothing matches the current filters.</p>`;
    const W = 960, L = 54, RM = 200, T = 24, B = 34, ph = 360 - T;
    const pw = W - L - RM;
    let t0 = Infinity, t1 = -Infinity;
    const lines = filtered.map(s => {
      const base = (s.points.find(p => p.sell != null) || {}).sell;
      if (!base) return null;
      const norm = s.points.map(p => ({ t: p.t, v: p.sell == null ? null : p.sell / base }));
      for (const p of norm) { if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; }
      return { name: s.item_name, norm };
    }).filter(Boolean);
    if (!lines.length) return `<p class="ph-empty">No sell-price data to plot.</p>`;
    let lo = Infinity, hi = -Infinity;
    for (const ln of lines) for (const p of ln.norm) if (p.v != null) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    lo = Math.min(lo, 1); hi = Math.max(hi, 1);
    // pad the band a touch
    const padBand = (hi - lo) * 0.08 || 0.1; lo -= padBand; hi += padBand;
    const xspan = (t1 - t0) || 1, yspan = (hi - lo) || 1;
    const xAt = (t) => L + ((t - t0) / xspan) * pw;
    const yAt = (v) => T + (1 - (v - lo) / yspan) * ph;
    const parts = [`<svg class="ph-overlay" viewBox="0 0 ${W} ${T + ph + B}">`,
      `<rect width="${W}" height="${T + ph + B}" fill="#0e1726"/>`];
    // gridlines at nice ratios
    const ticksY = [];
    for (let v = Math.ceil(lo * 4) / 4; v <= hi; v += 0.25) ticksY.push(v);
    for (const v of ticksY) {
      parts.push(`<line x1="${L}" y1="${yAt(v).toFixed(1)}" x2="${L + pw}" y2="${yAt(v).toFixed(1)}" stroke="${Math.abs(v - 1) < 1e-6 ? '#3a5070' : '#1d2a40'}" ${Math.abs(v - 1) < 1e-6 ? 'stroke-dasharray="4 3"' : ''}/>`);
      parts.push(`<text x="${L - 6}" y="${(yAt(v) + 4).toFixed(1)}" fill="#6f88ad" font-size="11" text-anchor="end">${v.toFixed(2)}×</text>`);
    }
    lines.forEach((ln, i) => {
      const color = COLORS[i % COLORS.length];
      const segs = [];
      let curSeg = [];
      for (const p of ln.norm) {
        if (p.v == null) { if (curSeg.length) segs.push(curSeg); curSeg = []; continue; }
        curSeg.push(`${xAt(p.t).toFixed(1)},${yAt(p.v).toFixed(1)}`);
      }
      if (curSeg.length) segs.push(curSeg);
      for (const seg of segs) parts.push(`<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.9"/>`);
      parts.push(`<line x1="${L + pw + 12}" y1="${T + 6 + i * 18}" x2="${L + pw + 30}" y2="${T + 6 + i * 18}" stroke="${color}" stroke-width="3"/>`);
      parts.push(`<text x="${L + pw + 34}" y="${T + 10 + i * 18}" fill="#cfe0f5" font-size="12">${esc(ln.name)}</text>`);
    });
    // x-axis date labels (start / end)
    const fmt = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
    parts.push(`<text x="${L}" y="${T + ph + 22}" fill="#6f88ad" font-size="11">${esc(fmt(t0))}</text>`);
    parts.push(`<text x="${L + pw}" y="${T + ph + 22}" fill="#6f88ad" font-size="11" text-anchor="end">${esc(fmt(t1))}</text>`);
    parts.push('</svg>');
    return `<div class="ph-overlay-note">Each line normalized to its first sell price in-window (start = 1.00×), so demand waves are comparable across price tiers.</div>${parts.join('\n')}`;
  }

  function chipsHtml(key, items) {
    return items.map(it => `<button class="ph-chip ${isActive(key, it.id) ? 'ph-chip-on' : ''}" data-key="${key}" data-value="${esc(it.id)}">${esc(it.name)}</button>`).join('');
  }

  function render() {
    if (!root) return;
    if (!data) { root.innerHTML = `<div id="ph-root" class="ph-page"><p class="ph-empty">Loading…</p></div>`; return; }
    const shops = availableShops();
    const body = mode === 'grid' ? gridHtml() : overlayHtml();
    root.innerHTML = `
      <div id="ph-root" class="ph-page">
        <header class="ph-head">
          <h1 class="ph-title">Price History <span class="ph-dev-badge">dev</span></h1>
          <p class="ph-sub">Replays recorded demand state through the live pricing math. Same filters as the Market page.</p>
        </header>
        <div class="ph-controls">
          <label class="ph-ctl">Window
            <select id="ph-days">
              ${[1, 3, 7, 14, 30].map(d => `<option value="${d}" ${d === days ? 'selected' : ''}>${d} day${d === 1 ? '' : 's'}</option>`).join('')}
            </select>
          </label>
          <div class="ph-toggle">
            <button id="ph-mode-grid" class="${mode === 'grid' ? 'on' : ''}">⊞ Grid</button>
            <button id="ph-mode-overlay" class="${mode === 'overlay' ? 'on' : ''}">▤ Overlay</button>
          </div>
          <span class="ph-status">${data.series.length} items · ${data.days}-day window</span>
        </div>
        <div class="ph-filters">
          <div class="ph-filter-row"><span class="ph-filter-label">Shops</span><div class="ph-chips">${chipsHtml('shops', shops)}</div></div>
          <div class="ph-filter-row"><span class="ph-filter-label">Categories</span><div class="ph-chips">${chipsHtml('categories', CATEGORIES)}</div></div>
        </div>
        <div class="ph-body ${mode === 'grid' ? 'ph-body-grid' : ''}">${body}</div>
      </div>`;

    q('#ph-days').onchange = (e) => { days = Number(e.target.value); load(); };
    q('#ph-mode-grid').onclick = () => { if (mode !== 'grid') { mode = 'grid'; render(); } };
    q('#ph-mode-overlay').onclick = () => { if (mode !== 'overlay') { mode = 'overlay'; render(); } };
    root.querySelectorAll('.ph-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const all = (key === 'shops' ? shops : CATEGORIES).map(x => x.id);
        toggleInSet(key, btn.dataset.value, all);
      });
    });
  }

  async function load() {
    render(); // shows Loading on first call; keeps current frame on re-load
    try {
      const res = await fetch(`/api/dev/price-history?days=${days}`);
      if (res.status === 403) { root.innerHTML = `<div class="ph-page"><p class="ph-empty">Dev only.</p></div>`; return; }
      if (!res.ok) { root.innerHTML = `<div class="ph-page"><p class="ph-empty">Could not load price history (${res.status}).</p></div>`; return; }
      data = await res.json();
      render();
    } catch (_) {
      root.innerHTML = `<div class="ph-page"><p class="ph-empty">Could not load price history.</p></div>`;
    }
  }

  async function mount(content) {
    root = content;
    if (typeof setLayoutTitle === 'function') setLayoutTitle('Price History');
    data = null;
    await load();
  }

  function unmount() {
    data = null;
    selected = { shops: null, categories: null };
    mode = 'grid';
    root = null;
  }

  window.Views = window.Views ?? {};
  window.Views.dev_price_history = { mount, unmount };
})();
