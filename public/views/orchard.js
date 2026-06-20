// View: Orchard — the Lumberjack profession layer. Plots multiply a planted item
// every roll (4h prod / 5min dev), capped at 6 rolls. Fertilizer (a pool = your
// plot count) shifts each plot's odds. See docs/orchard.md.
(function() {
  let data = null;
  let timer = null;
  let secs = 0;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const pct = (o) => `${Math.round(o * 100)}%`;
  const cap = () => data.cap_rolls || 6;
  const fertFactor = (f) => 0.5 + 0.5 * f;                       // mirrors orchard_service
  const effOdds = (baseOdds, f) => Math.min(1, baseOdds * fertFactor(f));
  const perRoll = (seed, odds) => Math.round(seed * odds * 10) / 10;   // ~7.2
  const perCycle = (seed, odds) => Math.round(seed * odds * cap());    // ~43

  async function mount(root) {
    setLayoutTitle('Orchard');
    root.innerHTML = `<section id="orchard-tab"><div id="orchard-body"><p class="empty">Loading…</p></div></section><div id="craft-toast"></div>`;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await load();
    timer = setInterval(tick, 1000);   // animate the roll bars + periodic refresh
  }
  function layoutChangedHandler() { if (data) load(); }

  function tick() {
    secs++;
    updateBars();
    if (secs % 12 === 0) load();   // refresh banked counts (also rolls due rolls server-side)
  }

  async function load() {
    const res = await fetch('/api/orchard');
    const body = document.getElementById('orchard-body');
    if (!res.ok) { if (body) body.innerHTML = '<p class="empty">Could not load the orchard.</p>'; return; }
    data = await res.json();
    render();
  }

  function render() {
    const body = document.getElementById('orchard-body');
    if (!body) return;
    if (data.plots === 0) {
      body.innerHTML = `<header class="orch-head"><h1 class="orch-title">Orchard</h1></header>
        <p class="orch-blurb">Reach <strong>Lumberjack rank 2</strong> to break ground on your first plot.</p>`;
      return;
    }
    body.innerHTML = `
      <header class="orch-head">
        <h1 class="orch-title">Orchard</h1>
        <span class="orch-meta">${data.plots} plot${data.plots > 1 ? 's' : ''} · up to ${data.capacity} each · <span class="orch-fert-pool">🌿 ${data.fertilizer_free}/${data.fertilizer_pool} fertilizer free</span></span>
      </header>
      <p class="orch-blurb">Plant a material; each roll, every seed has a chance to multiply, banking up to ${data.cap_rolls} rolls. Harvest takes the output — the seed's spent, so cheap mats pay off and pricey ones are a gamble. Fertilize a plot to raise its odds (1 = normal, 0 = lower, 2+ = boost).</p>
      <div class="orch-plots">${data.slots.map(plotCard).join('')}</div>`;
    updateBars();
    for (const s of data.slots) if (s.empty) onPick(s.slot);   // fill the plant projections
  }

  function fertRow(s) {
    const canAdd = data.fertilizer_free > 0;
    return `<div class="orch-fert">
      <span class="orch-fert-label">🌿 ${s.fertilizer}</span>
      <button class="orch-step" onclick="Views.orchard.fertilize(${s.slot}, ${s.fertilizer - 1})" ${s.fertilizer <= 0 ? 'disabled' : ''}>−</button>
      <button class="orch-step" onclick="Views.orchard.fertilize(${s.slot}, ${s.fertilizer + 1})" ${canAdd ? '' : 'disabled'}>+</button>
    </div>`;
  }

  function plotCard(s) {
    if (s.empty) {
      const opts = data.plantable.length === 0
        ? '<option disabled>No plantable materials</option>'
        : data.plantable.map(p => `<option value="${esc(p.item_id)}" data-odds="${p.odds}" data-mult="${p.multiplier}" data-owned="${p.owned}">${esc(p.name)} (own ${p.owned})</option>`).join('');
      return `
        <div class="orch-plot orch-empty">
          <div class="orch-plot-head"><p class="orch-plot-label">Empty plot</p>${fertRow(s)}</div>
          <select class="orch-select" id="orch-sel-${s.slot}" onchange="Views.orchard.onPick(${s.slot})">${opts}</select>
          <div class="orch-plant-row">
            <input class="orch-qty" id="orch-qty-${s.slot}" type="number" min="1" max="${data.capacity}" value="1" oninput="Views.orchard.onPick(${s.slot})">
            <button class="orch-btn orch-plant" onclick="Views.orchard.plant(${s.slot})" ${data.plantable.length === 0 ? 'disabled' : ''}>Plant</button>
          </div>
          <p class="orch-pick-note" id="orch-note-${s.slot}"></p>
        </div>`;
    }
    const full = s.ticks_until_cap === 0;
    const cyc = perCycle(s.seed_count, s.odds);
    const cls = s.multiplier >= 1 ? 'gain' : 'gamble';
    return `
      <div class="orch-plot orch-growing${full ? ' orch-full' : ''}">
        <div class="orch-plot-head"><p class="orch-plot-label">${esc(s.name)} <span class="orch-yield ${cls}">≈${cyc} a cycle</span></p>${fertRow(s)}</div>
        <p class="orch-stat">Seeded <strong>${s.seed_count}</strong> · banked <strong>${s.accrued}</strong> · ≈${perRoll(s.seed_count, s.odds)}/roll</p>
        <div class="orch-bar-wrap" data-slot="${s.slot}"><div class="orch-bar"></div></div>
        <p class="orch-stat orch-rolls">${full ? 'Full — harvest now' : `${s.ticks_banked}/${data.cap_rolls} rolls`}</p>
        <div class="orch-plant-row">
          <button class="orch-btn orch-harvest" onclick="Views.orchard.harvest(${s.slot}, false)">Harvest</button>
          <button class="orch-btn orch-harvest" onclick="Views.orchard.harvest(${s.slot}, true)">Harvest &amp; Replant</button>
          <button class="orch-btn orch-clear" onclick="Views.orchard.clear(${s.slot})" title="Clear the plot — the seed is lost">Clear</button>
        </div>
      </div>`;
  }

  // Animate each growing plot's bar toward its next roll.
  function updateBars() {
    if (!data) return;
    for (const s of data.slots) {
      if (s.empty) continue;
      const wrap = document.querySelector(`.orch-bar-wrap[data-slot="${s.slot}"] .orch-bar`);
      if (!wrap) continue;
      if (!s.next_roll_at) { wrap.style.width = '100%'; continue; }
      const remaining = new Date(s.next_roll_at).getTime() - Date.now();
      wrap.style.width = `${Math.max(0, Math.min(100, (1 - remaining / data.roll_ms) * 100))}%`;
    }
  }

  // Live projection for the chosen item + quantity at this plot's fertilizer.
  function onPick(slot) {
    const sel = document.getElementById(`orch-sel-${slot}`);
    const qtyEl = document.getElementById(`orch-qty-${slot}`);
    const note = document.getElementById(`orch-note-${slot}`);
    const opt = sel?.selectedOptions[0];
    if (!opt || !note) return;
    const plot = data.slots.find(x => x.slot === slot);
    const o = effOdds(Number(opt.dataset.odds), plot?.fertilizer ?? 0);
    const qty = Math.max(1, parseInt(qtyEl?.value, 10) || 1);
    const cyc = perCycle(qty, o);
    const gain = cyc > qty;
    note.className = `orch-pick-note ${gain ? 'gain' : 'gamble'}`;
    note.textContent = `Plant ${qty} → ≈${cyc} a cycle (≈${perRoll(qty, o)}/roll) — ${gain ? 'net gain' : 'a gamble, usually a loss'}`;
  }

  async function plant(slot) {
    const sel = document.getElementById(`orch-sel-${slot}`);
    const qtyEl = document.getElementById(`orch-qty-${slot}`);
    if (!sel?.value) return;
    await act('/api/orchard/plant', { slot, item_id: sel.value, quantity: Math.max(1, parseInt(qtyEl?.value, 10) || 1) });
  }
  async function harvest(slot, replant) { await act('/api/orchard/harvest', { slot, replant }); }
  async function fertilize(slot, fertilizer) { await act('/api/orchard/fertilize', { slot, fertilizer }, true); }
  async function clear(slot) {
    if (!confirm('Clear this plot? The planted seed is lost.')) return;
    await act('/api/orchard/clear', { slot });
  }

  async function act(url, body, quiet) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r = await res.json().catch(() => ({}));
    if (!quiet) toast(r.message ?? r.error, r.success !== false);
    await load();
    await mountLayout();
  }

  function toast(msg, ok) {
    const el = document.getElementById('craft-toast');
    if (!el || !msg) return;
    el.textContent = msg;
    el.className = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    if (timer) clearInterval(timer);
    timer = null; data = null;
  }

  window.Views = window.Views ?? {};
  window.Views.orchard = { mount, unmount, onPick, plant, harvest, fertilize, clear };
})();
