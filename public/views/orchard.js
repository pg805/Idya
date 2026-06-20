// View: Orchard — the Lumberjack profession layer. Plots multiply a planted item
// every 4h (capped at 24h). Cheap mats are a reliable grind; pricey items are a
// gamble (expected multiplier < 1). See docs/orchard.md.
(function() {
  let data = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const mult = (m) => (m >= 1 ? `×${m.toFixed(1)}` : `×${m.toFixed(2)}`);

  async function mount(root) {
    setLayoutTitle('Orchard');
    root.innerHTML = `<section id="orchard-tab"><div id="orchard-body"><p class="empty">Loading…</p></div></section><div id="craft-toast"></div>`;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await load();
  }
  function layoutChangedHandler() { if (data) load(); }

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
        <p class="orch-blurb">Reach <strong>Lumberjack rank 2</strong> to break ground on your first plot. Plots let you plant a material and multiply it over time.</p>`;
      return;
    }
    body.innerHTML = `
      <header class="orch-head">
        <h1 class="orch-title">Orchard</h1>
        <span class="orch-meta">${data.plots} plot${data.plots > 1 ? 's' : ''} · up to ${data.capacity} per plot</span>
      </header>
      <p class="orch-blurb">Plant a material; every 4 hours each seed has a chance to multiply, banking up to 24 hours of growth. Harvest takes the output — the seed's spent, so cheap mats pay off and pricey ones are a gamble.</p>
      <div class="orch-plots">${data.slots.map(plotCard).join('')}</div>`;
  }

  function plotCard(s) {
    if (s.empty) {
      const opts = data.plantable.length === 0
        ? '<option disabled>No plantable materials</option>'
        : data.plantable.map(p => `<option value="${esc(p.item_id)}" data-mult="${p.multiplier}" data-owned="${p.owned}">${esc(p.name)} — ${mult(p.multiplier)} · own ${p.owned}</option>`).join('');
      return `
        <div class="orch-plot orch-empty">
          <p class="orch-plot-label">Empty plot</p>
          <select class="orch-select" id="orch-sel-${s.slot}" onchange="Views.orchard.onPick(${s.slot})">${opts}</select>
          <p class="orch-pick-note" id="orch-note-${s.slot}"></p>
          <div class="orch-plant-row">
            <input class="orch-qty" id="orch-qty-${s.slot}" type="number" min="1" max="${s.capacity}" value="1">
            <button class="orch-btn orch-plant" onclick="Views.orchard.plant(${s.slot})" ${data.plantable.length === 0 ? 'disabled' : ''}>Plant</button>
          </div>
        </div>`;
    }
    const full = s.ticks_until_cap === 0;
    return `
      <div class="orch-plot orch-growing${full ? ' orch-full' : ''}">
        <p class="orch-plot-label">${esc(s.name)} <span class="orch-mult ${s.multiplier >= 1 ? 'gain' : 'gamble'}">${mult(s.multiplier)}</span></p>
        <p class="orch-stat">Seeded <strong>${s.seed_count}</strong> · banked <strong>${s.accrued}</strong> ${esc(s.name)}</p>
        <p class="orch-stat orch-ticks">${full ? 'Full — harvest now' : `${s.ticks_banked}/6 ticks (harvest within 24h)`}</p>
        <div class="orch-plant-row">
          <button class="orch-btn orch-harvest" onclick="Views.orchard.harvest(${s.slot}, false)">Harvest</button>
          <button class="orch-btn orch-harvest" onclick="Views.orchard.harvest(${s.slot}, true)">Harvest &amp; Replant</button>
          <button class="orch-btn orch-clear" onclick="Views.orchard.clear(${s.slot})" title="Clear the plot — the seed is lost">Clear</button>
        </div>
      </div>`;
  }

  function onPick(slot) {
    const sel = document.getElementById(`orch-sel-${slot}`);
    const note = document.getElementById(`orch-note-${slot}`);
    const opt = sel?.selectedOptions[0];
    if (!opt || !note) return;
    const m = Number(opt.dataset.mult);
    note.className = `orch-pick-note ${m >= 1 ? 'gain' : 'gamble'}`;
    note.textContent = m >= 1 ? `Expected ${mult(m)} — a net gain.` : `Expected ${mult(m)} — a gamble, you'll usually lose some.`;
  }

  async function plant(slot) {
    const sel = document.getElementById(`orch-sel-${slot}`);
    const qtyEl = document.getElementById(`orch-qty-${slot}`);
    if (!sel?.value) return;
    const quantity = Math.max(1, parseInt(qtyEl?.value, 10) || 1);
    await act(`/api/orchard/plant`, { slot, item_id: sel.value, quantity });
  }
  async function harvest(slot, replant) { await act('/api/orchard/harvest', { slot, replant }); }
  async function clear(slot) {
    if (!confirm('Clear this plot? The planted seed is lost.')) return;
    await act('/api/orchard/clear', { slot });
  }

  async function act(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r = await res.json().catch(() => ({}));
    toast(r.message ?? r.error, r.success !== false);
    await load();
    await mountLayout();   // refresh header (inventory-adjacent)
  }

  function toast(msg, ok) {
    const el = document.getElementById('craft-toast');
    if (!el || !msg) return;
    el.textContent = msg;
    el.className = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() { window.removeEventListener('layout-changed', layoutChangedHandler); data = null; }

  window.Views = window.Views ?? {};
  window.Views.orchard = { mount, unmount, onPick, plant, harvest, clear };
})();
