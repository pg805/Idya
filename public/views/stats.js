// View: Stats — everything permanent the character owns.
// Trophies (defeated counts) and permits (one-time unlocks) live here
// instead of the regular Inventory page so the inventory stays focused
// on consumables, materials, valuables, and weapons.
(function() {
  let data = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Trophy tiers from defeat count.
  //   1-99    → none   (default look)
  //   100-299 → bronze
  //   300-999 → silver
  //   1000+   → gold
  function tierFor(count) {
    if (count >= 1000) return 'gold';
    if (count >= 300)  return 'silver';
    if (count >= 100)  return 'bronze';
    return 'none';
  }
  const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

  async function mount(root) {
    setLayoutTitle('Stats');
    root.innerHTML = `<div id="stats-body"><p class="stats-empty">Loading…</p></div>`;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await loadData();
  }

  function layoutChangedHandler() { if (data) loadData(); }

  async function loadData() {
    const res = await fetch('/api/inventory');
    const body = document.getElementById('stats-body');
    if (!res.ok) {
      body.innerHTML = `<p class="stats-empty">Could not load stats.</p>`;
      return;
    }
    data = await res.json();
    render();
  }

  function render() {
    const body = document.getElementById('stats-body');
    if (!body) return;

    const unlocks = (data.items ?? []).filter(i => i.type === 'unlock');
    // Trophies — item_id convention is `${enemy_key}_trophy`. Anything else
    // is a "keepsake" — the catch-all bucket for non-combat unlocks (swallow
    // bait permit, future location keys, etc.).
    const trophies  = unlocks.filter(i => i.item_id.endsWith('_trophy'));
    const keepsakes = unlocks.filter(i => !i.item_id.endsWith('_trophy'));

    if (unlocks.length === 0) {
      body.innerHTML = `
        <header class="stats-head">
          <h1 class="stats-title">Stats</h1>
        </header>
        <p class="stats-empty">No permanent items yet. Defeat an enemy to earn a trophy, or pick up a keepsake from a shop.</p>
      `;
      return;
    }

    let sections = '';
    if (trophies.length > 0) {
      // Sort by defeated count descending; ties fall back to name alpha.
      trophies.sort((a, b) => (b.defeated_count ?? 0) - (a.defeated_count ?? 0) || a.name.localeCompare(b.name));
      sections += `
        <section class="stats-section">
          <h2 class="stats-section-label">Trophies</h2>
          <div class="stats-grid">
            ${trophies.map(t => {
              const count = t.defeated_count ?? 0;
              const tier  = tierFor(count);
              const tierBadge = tier === 'none' ? '' : `<span class="stats-tier-badge stats-tier-${tier}">${TIER_LABEL[tier]}</span>`;
              return `
                <div class="stats-card stats-card-${tier}">
                  <div class="stats-card-head">
                    <h3 class="stats-card-name">${esc(t.name)}${tierBadge}</h3>
                    <span class="stats-card-count">${count.toLocaleString()}<span class="stats-card-count-suffix"> defeated</span></span>
                  </div>
                  <p class="stats-card-desc">${esc(t.description)}</p>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }

    if (keepsakes.length > 0) {
      keepsakes.sort((a, b) => a.name.localeCompare(b.name));
      sections += `
        <section class="stats-section">
          <h2 class="stats-section-label">Keepsakes</h2>
          <div class="stats-grid">
            ${keepsakes.map(p => `
              <div class="stats-card">
                <div class="stats-card-head">
                  <h3 class="stats-card-name">${esc(p.name)}</h3>
                  <span class="stats-card-tag">permanent</span>
                </div>
                <p class="stats-card-desc">${esc(p.description)}</p>
              </div>
            `).join('')}
          </div>
        </section>
      `;
    }

    body.innerHTML = `
      <header class="stats-head">
        <h1 class="stats-title">Stats</h1>
        <p class="stats-sub">Permanent items you've earned. Trophies show how many times you've defeated each enemy; keepsakes unlock recurring activities.</p>
      </header>
      ${sections}
    `;
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    data = null;
  }

  window.Views = window.Views ?? {};
  window.Views.stats = { mount, unmount };
})();
