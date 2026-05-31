// View: Hunt — pick a bait, head into the forest.
(function() {
  let data = null;
  let starting = false;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dropSummary(d) {
    const field = d.field ?? [];
    if (field.length === 0) return `${esc(d.name)}`;
    const min = Math.min(...field);
    const max = Math.max(...field);
    const range = min === max ? `${min}` : `${min}–${max}`;
    return `${esc(d.name)} <span class="hunt-drop-range">${range}</span>`;
  }

  async function mount(root) {
    setLayoutTitle('Hunt');
    root.innerHTML = `<div id="hunt-body"><p class="hunt-empty">Loading…</p></div>`;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await loadData();
  }

  function layoutChangedHandler() { if (data) loadData(); }

  async function loadData() {
    const res = await fetch('/api/hunt');
    const body = document.getElementById('hunt-body');
    if (!res.ok) {
      body.innerHTML = `<p class="hunt-empty">Could not load hunt info.</p>`;
      return;
    }
    data = await res.json();
    render();
  }

  function render() {
    const body = document.getElementById('hunt-body');

    if (!data.tutorial_complete) {
      body.innerHTML = `
        <header class="hunt-head">
          <h1 class="hunt-title">Sulkupa Forest</h1>
          <p class="hunt-sub">The forest is closed to you for now.</p>
        </header>
        <p class="hunt-empty">Talk to Fendalok first — use <code>/battle</code> in Discord to begin the tutorial.</p>
      `;
      return;
    }

    if (data.baits.length === 0) {
      body.innerHTML = `
        <header class="hunt-head">
          <h1 class="hunt-title">Sulkupa Forest</h1>
          <p class="hunt-sub">The trees are dense this far out. You need bait to draw something in.</p>
        </header>
        <p class="hunt-empty">No bait in your pack. Pick some up at the <a href="/app/shop/general_store">General Store</a>.</p>
      `;
      bindNav(body);
      return;
    }

    const cardsHtml = data.baits.map(b => `
      <article class="hunt-card" data-bait="${esc(b.bait_id)}">
        <div class="hunt-card-art">
          <img src="${esc(b.enemy_sprite)}" alt="${esc(b.enemy_name)}" onerror="this.style.visibility='hidden'">
        </div>
        <div class="hunt-card-body">
          <div class="hunt-card-headline">
            <h2 class="hunt-enemy-name">${esc(b.enemy_name)}</h2>
            <span class="hunt-hp">${b.enemy_health} HP</span>
          </div>
          <div class="hunt-bait-line">
            <span class="hunt-bait-name">${esc(b.bait_name)}</span>
            <span class="hunt-bait-qty">×${b.quantity}</span>
          </div>
          ${b.drops.length > 0 ? `
            <div class="hunt-drops">
              <p class="hunt-drops-label">Drops</p>
              <ul class="hunt-drops-list">
                ${b.drops.map(d => `<li>${dropSummary(d)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          <button class="hunt-start" data-bait="${esc(b.bait_id)}">Start Hunt</button>
        </div>
      </article>
    `).join('');

    body.innerHTML = `
      <header class="hunt-head">
        <h1 class="hunt-title">Sulkupa Forest</h1>
        <p class="hunt-sub">Pick a bait. One bait is consumed each hunt.</p>
      </header>
      <div class="hunt-grid">${cardsHtml}</div>
      <p id="hunt-error" class="hunt-error" hidden></p>
    `;

    body.querySelectorAll('.hunt-start').forEach(btn => {
      btn.addEventListener('click', () => startHunt(btn.dataset.bait, btn));
    });
    bindNav(body);
  }

  function bindNav(root) {
    root.querySelectorAll('a[href^="/app/"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const path = a.getAttribute('href').slice(4);
        history.pushState(null, '', a.getAttribute('href'));
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    });
  }

  async function startHunt(baitId, btn) {
    if (starting) return;
    starting = true;
    const err = document.getElementById('hunt-error');
    if (err) err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Entering…';
    try {
      const res = await fetch('/api/hunt/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bait_id: baitId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.session_url) {
        throw new Error(json.error || 'Could not start the hunt.');
      }
      location.href = json.session_url;
    } catch (e) {
      starting = false;
      btn.disabled = false;
      btn.textContent = 'Start Hunt';
      if (err) { err.textContent = e.message; err.hidden = false; }
    }
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    data = null;
    starting = false;
  }

  window.Views = window.Views ?? {};
  window.Views.hunt = { mount, unmount };
})();
