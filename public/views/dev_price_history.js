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
  // Break a value series into polyline-point segments (splitting on nulls),
  // mapping time→x and value→y over the given domains. y is clamped into the
  // plot area so transaction-shock spikes beyond the expected band sit on the
  // edge rather than drawing off-chart.
  function segments(points, accessor, t0, t1, lo, hi, W, H, pad) {
    const xspan = (t1 - t0) || 1, yspan = (hi - lo) || 1;
    const xAt = (t) => pad + ((t - t0) / xspan) * (W - 2 * pad);
    const yAt = (v) => {
      const y = pad + (1 - (v - lo) / yspan) * (H - 2 * pad);
      return Math.max(pad, Math.min(H - pad, y));
    };
    const segs = [];
    let cur = [];
    for (const p of points) {
      const v = accessor(p);
      if (v == null) { if (cur.length) segs.push(cur); cur = []; continue; }
      cur.push(`${xAt(p.t).toFixed(1)},${yAt(v).toFixed(1)}`);
    }
    if (cur.length) segs.push(cur);
    return { segs, xAt, yAt };
  }

  // Mini chart: fixed y-axis = the item's sell range (same band the Market page
  // shows), so the wave's height reads directly as "where in its range". Floor
  // and ceiling are drawn as reference lines; a dot marks the current price.
  function miniChart(s) {
    const W = 280, H = 76, pad = 8;
    const sells = s.points.map(p => p.sell).filter(v => v != null);
    if (sells.length < 2) return `<div class="ph-mini-empty">not enough data</div>`;
    const range = s.range_sell;
    // Domain is the expected band; widen only if observed prices overshoot it
    // (shocks can briefly exceed) so nothing is silently clipped flat.
    let lo = range ? range.min : Math.min(...sells);
    let hi = range ? range.max : Math.max(...sells);
    lo = Math.min(lo, ...sells); hi = Math.max(hi, ...sells);
    const t0 = s.points[0].t, t1 = s.points[s.points.length - 1].t;
    const { segs, xAt, yAt } = segments(s.points, (p) => p.sell, t0, t1, lo, hi, W, H, pad);
    const refs = [];
    if (range) {
      refs.push(`<line x1="0" y1="${yAt(range.max).toFixed(1)}" x2="${W}" y2="${yAt(range.max).toFixed(1)}" stroke="#2a3a55" stroke-dasharray="3 3"/>`);
      refs.push(`<line x1="0" y1="${yAt(range.min).toFixed(1)}" x2="${W}" y2="${yAt(range.min).toFixed(1)}" stroke="#2a3a55" stroke-dasharray="3 3"/>`);
    }
    const line = segs.map(pts => `<polyline points="${pts}" fill="none" stroke="#4fa3ff" stroke-width="1.5"/>`).join('');
    const last = s.points[s.points.length - 1];
    const dot = last.sell != null
      ? `<circle cx="${xAt(last.t).toFixed(1)}" cy="${yAt(last.sell).toFixed(1)}" r="3" fill="#ffb14f"/>` : '';
    return `<svg class="ph-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${refs.join('')}${line}${dot}</svg>`;
  }

  function cur(s, key) {
    for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i][key] != null) return s.points[i][key];
    return null;
  }

  // Position of the current price within its expected band, 0 (floor) → 1 (ceiling).
  function rangePos(s) {
    const now = cur(s, 'sell'), r = s.range_sell;
    if (now == null || !r || r.max <= r.min) return null;
    return Math.max(0, Math.min(1, (now - r.min) / (r.max - r.min)));
  }

  function itemBlock(s) {
    const r = s.range_sell;
    const nowSell = cur(s, 'sell');
    const pos = rangePos(s);
    const posTxt = pos == null ? '' : ` · ${Math.round(pos * 100)}% of range`;
    return `
      <div class="ph-item">
        <div class="ph-item-head">
          <span class="ph-item-name">${esc(s.item_name)}${s.source === 'recipe' ? '<span class="ph-tag">crafted</span>' : ''}</span>
          <span class="ph-item-now">sell ${nowSell ?? '—'}<span class="ph-range">${posTxt}</span></span>
        </div>
        ${miniChart(s)}
        <div class="ph-item-foot">${r ? `<span>floor ${r.min}</span><span>ceiling ${r.max}</span>` : '<span>no band</span>'}</div>
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

  // Overlay: every selected item on one shared 0→1 axis = its position within
  // its own expected sell band (0 = floor, 1 = ceiling). This makes "where is
  // each item in its range right now" directly comparable across price tiers.
  function overlayHtml() {
    const filtered = filteredSeries();
    if (!filtered.length) return `<p class="ph-empty">Nothing matches the current filters.</p>`;
    const W = 960, L = 54, RM = 200, T = 24, B = 34, ph = 360 - T;
    const pw = W - L - RM;
    let t0 = Infinity, t1 = -Infinity;
    const lines = filtered.map(s => {
      const r = s.range_sell;
      if (!r || r.max <= r.min) return null;
      const norm = s.points.map(p => ({
        t: p.t,
        v: p.sell == null ? null : Math.max(0, Math.min(1, (p.sell - r.min) / (r.max - r.min))),
      }));
      for (const p of norm) { if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; }
      return { name: s.item_name, norm };
    }).filter(Boolean);
    if (!lines.length) return `<p class="ph-empty">No banded items to plot (selection has no expected ranges).</p>`;
    const xspan = (t1 - t0) || 1;
    const xAt = (t) => L + ((t - t0) / xspan) * pw;
    const yAt = (v) => T + (1 - v) * ph; // 0 = floor (bottom), 1 = ceiling (top)
    const parts = [`<svg class="ph-overlay" viewBox="0 0 ${W} ${T + ph + B}">`,
      `<rect width="${W}" height="${T + ph + B}" fill="#0e1726"/>`];
    // floor / mid / ceiling reference lines
    const refRows = [[0, 'floor'], [0.25, ''], [0.5, 'mid'], [0.75, ''], [1, 'ceiling']];
    for (const [v, label] of refRows) {
      const edge = v === 0 || v === 1;
      parts.push(`<line x1="${L}" y1="${yAt(v).toFixed(1)}" x2="${L + pw}" y2="${yAt(v).toFixed(1)}" stroke="${edge ? '#3a5070' : '#1d2a40'}" ${edge ? 'stroke-dasharray="4 3"' : ''}/>`);
      parts.push(`<text x="${L - 6}" y="${(yAt(v) + 4).toFixed(1)}" fill="#6f88ad" font-size="11" text-anchor="end">${Math.round(v * 100)}%</text>`);
      if (label) parts.push(`<text x="${L + pw + 4}" y="${(yAt(v) + 4).toFixed(1)}" fill="#3a5070" font-size="10">${label}</text>`);
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
    const fmt = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
    parts.push(`<text x="${L}" y="${T + ph + 22}" fill="#6f88ad" font-size="11">${esc(fmt(t0))}</text>`);
    parts.push(`<text x="${L + pw}" y="${T + ph + 22}" fill="#6f88ad" font-size="11" text-anchor="end">${esc(fmt(t1))}</text>`);
    parts.push('</svg>');
    return `<div class="ph-overlay-note">Each line is the price's position within its own expected sell band (0% = floor, 100% = ceiling) — same bounds as the Market page, so items at different price tiers are directly comparable.</div>${parts.join('\n')}`;
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
