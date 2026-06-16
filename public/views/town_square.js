// View: Town Square — global timed quests. Deposit a gathered item toward a
// shared target for a fixed payout; the leaderboard tracks top contributors.
(function() {
  let data = null;
  let pollTimer = null;
  let prevQuests = [];   // [{id, name}] from the last poll, to detect quests that just ended

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeLeft(endsAt) {
    const ms = new Date(endsAt).getTime() - Date.now();
    if (ms <= 0) return 'ending…';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  async function mount(root) {
    setLayoutTitle('Town Square');
    root.innerHTML = `<section id="ts-tab"><div id="ts-body"><p class="empty">Loading…</p></div></section><div id="craft-toast"></div>`;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await load();
    pollTimer = setInterval(load, 30000);   // live countdown / leaderboard + end detection
  }

  function layoutChangedHandler() { if (data) load(); }

  async function load() {
    const res = await fetch('/api/townsquare');
    const body = document.getElementById('ts-body');
    if (!res.ok) { if (body) body.innerHTML = '<p class="empty">Could not load Town Square.</p>'; return; }
    data = await res.json();
    // A quest that was active last poll but is gone now just ended → tell the player.
    const nowIds = (data.quests ?? []).map(q => q.id);
    for (const prev of prevQuests) {
      if (!nowIds.includes(prev.id)) toast(`"${prev.name}" has ended — check your Stats for your trophy!`, true);
    }
    prevQuests = (data.quests ?? []).map(q => ({ id: q.id, name: q.name }));
    render();
  }

  function render() {
    const body = document.getElementById('ts-body');
    if (!body) return;
    // Preserve the in-progress deposit amount + focus across the periodic re-render.
    const prevAmts = {};
    body.querySelectorAll('input[id^="ts-amt-"]').forEach(i => { prevAmts[i.id] = i.value; });
    const focusId = document.activeElement && document.activeElement.id;

    const quests = data.quests ?? [];
    body.innerHTML = quests.length === 0
      ? `<header class="ts-head"><h1 class="ts-title">Town Square</h1></header>
         <p class="ts-blurb">The square is quiet today — folk mill about trading gossip, waiting for the next call to action. When the town needs something gathered, the notice goes up right here.</p>`
      : `<header class="ts-head"><h1 class="ts-title">Town Square</h1></header>
         <div class="ts-cards">${quests.map(card).join('')}</div>`;

    Object.entries(prevAmts).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
  }

  function card(q) {
    const pct = Math.min(100, Math.round((100 * q.deposited) / Math.max(1, q.target)));
    const lb = q.leaderboard.length
      ? q.leaderboard.map(e => `<li class="${e.you ? 'ts-you' : ''}"><span class="ts-lb-rank">${e.rank}</span><span class="ts-lb-name">${esc(e.name)}${e.you ? ' (you)' : ''}</span><span class="ts-lb-qty">${e.quantity.toLocaleString()}</span></li>`).join('')
      : '<li class="ts-lb-empty">No deposits yet — be the first.</li>';
    const canDeposit = q.my_inventory > 0;
    return `
      <div class="ts-card">
        <div class="ts-card-head">
          <h2 class="ts-card-name">${esc(q.name)}</h2>
          <span class="ts-card-time">ends in ${timeLeft(q.ends_at)}</span>
        </div>
        <p class="ts-card-lore">${esc(q.lore)}</p>
        <div class="ts-progress"><div class="ts-progress-bar" style="width:${pct}%"></div></div>
        <p class="ts-progress-label">${q.deposited.toLocaleString()} / ${q.target.toLocaleString()} ${esc(q.item_name)} · paying <strong>${q.price}</strong> korel each</p>
        <div class="ts-deposit">
          ${QtyStepper.html({ id: `ts-amt-${esc(q.id)}`, value: canDeposit ? 1 : 0, min: 1, max: q.my_inventory, disabled: !canDeposit })}
          <button class="upg-btn" ${canDeposit ? '' : 'disabled'} onclick="Views.town_square.deposit('${esc(q.id)}')">Deposit</button>
          <span class="ts-deposit-info">You have ${q.my_inventory.toLocaleString()} · deposited ${q.my_deposit.toLocaleString()}</span>
        </div>
        <div class="ts-leaderboard">
          <h3 class="ts-lb-title">Leaderboard</h3>
          <ol class="ts-lb-list">${lb}</ol>
        </div>
      </div>`;
  }

  async function deposit(id) {
    const quantity = QtyStepper.val('ts-amt-' + id);
    if (!quantity || quantity <= 0) { toast('Enter a positive amount.', false); return; }
    const res = await fetch(`/api/quests/${id}/deposit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { await load(); await mountLayout(); }   // refresh card + korel header
    else await load();                                      // quest may have just ended — refresh state
  }

  function toast(msg, ok) {
    const el = document.getElementById('craft-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    prevQuests = [];
    data = null;
  }

  window.Views = window.Views ?? {};
  window.Views.town_square = { mount, unmount, deposit };
})();
