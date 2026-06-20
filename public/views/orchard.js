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
  const dur = (ms) => {                                           // friendly roll interval (4h prod / 5min dev)
    const h = ms / 3600000;
    if (h >= 1) return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
    const m = Math.round(ms / 60000);
    return `${m} minute${m === 1 ? '' : 's'}`;
  };
  const fertFactor = (f) => 0.5 + 0.5 * f;                       // mirrors orchard_service
  const effOdds = (baseOdds, f) => Math.min(1, baseOdds * fertFactor(f));

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
    if (secs % 12 === 0) poll();   // refresh live numbers without rebuilding the forms
  }

  async function load() {
    const res = await fetch('/api/orchard');
    const body = document.getElementById('orchard-body');
    if (!res.ok) { if (body) body.innerHTML = '<p class="empty">Could not load the orchard.</p>'; return; }
    data = await res.json();
    render();
  }

  // Periodic refresh that updates ONLY the changing numbers (banked / rolls / bar /
  // pool) in place — so it never resets a dropdown or quantity you're editing.
  // Full re-render only if the plot structure actually changed (e.g. another tab).
  async function poll() {
    const res = await fetch('/api/orchard');
    if (!res.ok) return;
    const fresh = await res.json();
    const structural = !data || fresh.plots !== data.plots || fresh.slots.length !== data.slots.length ||
      fresh.slots.some((s, i) => s.empty !== data.slots[i]?.empty || s.item_id !== data.slots[i]?.item_id);
    data = fresh;
    if (structural) { render(); return; }
    const fp = document.querySelector('.orch-fert-pool');
    if (fp) fp.textContent = `🌿 ${data.fertilizer_free}/${data.fertilizer_pool} fertilizer free`;
    for (const s of data.slots) {
      if (s.empty) continue;
      const b = document.getElementById(`orch-banked-${s.slot}`);
      if (b) b.textContent = s.accrued;
      const r = document.getElementById(`orch-rolls-${s.slot}`);
      if (r) {
        const full = s.ticks_until_cap === 0;
        r.textContent = full ? 'Full — harvest now' : `${s.ticks_banked}/${data.cap_rolls} rolls`;
        r.closest('.orch-plot')?.classList.toggle('orch-full', full);
      }
    }
    updateBars();
  }

  function render() {
    const body = document.getElementById('orchard-body');
    if (!body) return;
    // Capture in-progress plant picks (from the existing DOM) to restore after.
    const prevSel = {}, prevQty = {};
    body.querySelectorAll('[id^="orch-sel-"]').forEach(el => { prevSel[el.id] = el.value; });
    body.querySelectorAll('[id^="orch-qty-"]').forEach(el => { prevQty[el.id] = el.value; });
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
      <p class="orch-blurb">Plant items to try to multiply them. A plot rolls to multiply its planted item every ${dur(data.roll_ms)}, stopping after ${dur(data.roll_ms * data.cap_rolls)}. Harvest to collect what grew. More fertilizer means a higher chance to multiply.</p>
      <div class="orch-plots">${data.slots.map(plotCard).join('')}</div>`;
    // Restore any in-progress plant picks so a re-render (e.g. after fertilizing)
    // doesn't reset the dropdown/quantity.
    for (const id in prevSel) { const el = document.getElementById(id); if (el && [...el.options].some(o => o.value === prevSel[id])) el.value = prevSel[id]; }
    for (const id in prevQty) { const el = document.getElementById(id); if (el) el.value = prevQty[id]; }
    updateBars();
    for (const s of data.slots) if (s.empty) onPick(s.slot);   // fill the % notes
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
        : data.plantable.map(p => `<option value="${esc(p.item_id)}" data-odds="${p.odds}" data-owned="${p.owned}">${esc(p.name)} (own ${p.owned})</option>`).join('');
      return `
        <div class="orch-plot orch-empty">
          <div class="orch-plot-head"><p class="orch-plot-label">Empty plot</p>${fertRow(s)}</div>
          <select class="orch-select" id="orch-sel-${s.slot}" onchange="Views.orchard.onPick(${s.slot})">${opts}</select>
          <p class="orch-pick-note" id="orch-note-${s.slot}"></p>
          <div class="orch-plant-row">
            ${window.QtyStepper ? QtyStepper.html({ id: `orch-qty-${s.slot}`, value: 1, min: 1, max: data.capacity, all: true }) : `<input id="orch-qty-${s.slot}" type="number" min="1" value="1">`}
            <button class="orch-btn orch-plant" onclick="Views.orchard.plant(${s.slot})" ${data.plantable.length === 0 ? 'disabled' : ''}>Plant</button>
          </div>
        </div>`;
    }
    const full = s.ticks_until_cap === 0;
    const cls = s.multiplier >= 1 ? 'gain' : 'gamble';
    return `
      <div class="orch-plot orch-growing${full ? ' orch-full' : ''}">
        <div class="orch-plot-head"><p class="orch-plot-label">${esc(s.name)} <span class="orch-yield ${cls}">${pct(s.odds)} / seed</span></p>${fertRow(s)}</div>
        <p class="orch-stat">Seeded <strong>${s.seed_count}</strong> · banked <strong id="orch-banked-${s.slot}">${s.accrued}</strong></p>
        <div class="orch-bar-wrap" data-slot="${s.slot}"><div class="orch-bar"></div></div>
        <p class="orch-stat orch-rolls" id="orch-rolls-${s.slot}">${full ? 'Full — harvest now' : `${s.ticks_banked}/${data.cap_rolls} rolls`}</p>
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

  // The chosen item's per-seed odds at this plot's fertilizer (gain vs gamble).
  function onPick(slot) {
    const sel = document.getElementById(`orch-sel-${slot}`);
    const note = document.getElementById(`orch-note-${slot}`);
    const opt = sel?.selectedOptions[0];
    if (!opt || !note) return;
    const plot = data.slots.find(x => x.slot === slot);
    const o = effOdds(Number(opt.dataset.odds), plot?.fertilizer ?? 0);
    const gain = o * cap() >= 1;
    note.className = `orch-pick-note ${gain ? 'gain' : 'gamble'}`;
    note.textContent = `${pct(o)} per seed`;
    // Cap the quantity field at what you actually own (and the plot capacity).
    const owned = Number(opt.dataset.owned) || 0;
    if (window.QtyStepper) QtyStepper.setMax(`orch-qty-${slot}`, Math.max(1, Math.min(data.capacity, owned)));
  }

  async function plant(slot) {
    const sel = document.getElementById(`orch-sel-${slot}`);
    if (!sel?.value) return;
    const quantity = (window.QtyStepper ? QtyStepper.val(`orch-qty-${slot}`) : parseInt(document.getElementById(`orch-qty-${slot}`)?.value, 10)) || 1;
    await act('/api/orchard/plant', { slot, item_id: sel.value, quantity });
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
