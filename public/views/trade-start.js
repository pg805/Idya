// View: Trade start — typeahead character search to initiate a trade.
(function() {
  let searchTimer = null;
  let lastQuery = '';

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function mount(root) {
    setLayoutTitle('Trade');
    root.innerHTML = `
      <div id="trade-start-body">
        <section class="trade-start-card">
          <h2 class="trade-start-title">Start a trade</h2>
          <p class="trade-start-hint">Type a character's name to find them. Both of you'll get a link to the trade session.</p>
          <input id="trade-start-input" type="text" placeholder="Character name…" autocomplete="off">
          <div id="trade-start-results"></div>
        </section>
      </div>
      <div id="trade-toast"></div>
    `;

    const input = document.getElementById('trade-start-input');
    input.addEventListener('input', onInput);
    input.focus();
  }

  function onInput(e) {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (q === lastQuery) return;
    lastQuery = q;
    if (q.length === 0) {
      renderResults([], '');
      return;
    }
    searchTimer = setTimeout(() => search(q), 180);
  }

  async function search(q) {
    try {
      const res = await fetch(`/api/players?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        renderResults([], 'Could not search players.');
        return;
      }
      const data = await res.json();
      if (q !== lastQuery) return;  // a newer query arrived while we awaited
      renderResults(data.players ?? [], '');
    } catch (_) {
      renderResults([], 'Network error.');
    }
  }

  function renderResults(players, errorMsg) {
    const el = document.getElementById('trade-start-results');
    if (!el) return;
    if (errorMsg) {
      el.innerHTML = `<p class="trade-start-empty err">${esc(errorMsg)}</p>`;
      return;
    }
    if (lastQuery.length === 0) {
      el.innerHTML = '';
      return;
    }
    if (players.length === 0) {
      el.innerHTML = `<p class="trade-start-empty">No characters match "${esc(lastQuery)}".</p>`;
      return;
    }
    el.innerHTML = players.map(p => `
      <button class="trade-start-row" data-id="${esc(p.discord_id)}" data-name="${esc(p.name)}">
        <span class="trade-start-row-name">${esc(p.name)}</span>
        ${p.nationality ? `<span class="trade-start-row-meta">${esc(p.nationality)}</span>` : ''}
      </button>
    `).join('');
    el.querySelectorAll('.trade-start-row').forEach(btn => {
      btn.addEventListener('click', () => startTrade(btn.dataset.id, btn.dataset.name));
    });
  }

  async function startTrade(targetDiscordId, targetName) {
    document.querySelectorAll('.trade-start-row').forEach(b => b.disabled = true);
    try {
      const res = await fetch('/api/trade/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ target_discord_id: targetDiscordId }),
      });
      const r = await res.json();
      if (!r.success) {
        toast(r.message ?? r.error ?? 'Could not start trade.', false);
        document.querySelectorAll('.trade-start-row').forEach(b => b.disabled = false);
        return;
      }
      if (r.dm_status === 'failed') {
        toast(`Could not DM ${targetName} — they may have DMs off. Opening the trade anyway.`, false);
      } else {
        toast(`Trade with ${targetName} started — opening…`, true);
      }
      setTimeout(() => navigate(`/trade/${r.trade_id}`), 400);
    } catch (_) {
      toast('Network error.', false);
      document.querySelectorAll('.trade-start-row').forEach(b => b.disabled = false);
    }
  }

  function toast(msg, ok) {
    const el = document.getElementById('trade-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    clearTimeout(searchTimer);
    searchTimer = null;
    lastQuery = '';
  }

  window.Views = window.Views ?? {};
  window.Views['trade-start'] = { mount, unmount };
})();
