// View: Trade — two-panel real-time item trade.
(function() {
  let socket = null;
  let state  = null;
  let tradeId = null;
  let items   = [];  // [{ item_id, name, quantity }]
  let myOffer = {};  // item_id → quantity
  let nameById = {}; // item_id → display name (for "their" panel)

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function mount(root, params) {
    tradeId = params.tradeId;
    setLayoutTitle('Trade');
    root.innerHTML = `
      <div id="trade-body">
        <div id="trade-status" class="trade-status">Connecting…</div>
        <div id="trade-panels" style="display:none">
          <section class="trade-panel">
            <h2 class="trade-panel-title">Your Offer <span id="your-name" class="trade-panel-sub"></span></h2>
            <div id="your-inventory" class="trade-list"></div>
          </section>
          <div class="trade-divider">
            <button id="lock-btn" class="trade-btn trade-btn-lock">Lock In</button>
            <button id="confirm-btn" class="trade-btn trade-btn-confirm" style="display:none">Confirm Trade</button>
            <button id="cancel-btn" class="trade-btn trade-btn-cancel">Cancel</button>
          </div>
          <section class="trade-panel">
            <h2 class="trade-panel-title">Their Offer <span id="their-name" class="trade-panel-sub"></span></h2>
            <div id="their-offer" class="trade-list"></div>
          </section>
        </div>
      </div>
      <div id="trade-toast"></div>
    `;

    document.getElementById('lock-btn').addEventListener('click', doLock);
    document.getElementById('confirm-btn').addEventListener('click', doConfirm);
    document.getElementById('cancel-btn').addEventListener('click', doCancel);

    await loadInventory();
    connectSocket();
  }

  async function loadInventory() {
    const res = await fetch('/api/inventory');
    if (!res.ok) {
      setStatus('Could not load inventory.', 'err');
      return;
    }
    const data = await res.json();
    items = (data.items ?? []).filter(i => i.quantity > 0);
    nameById = Object.fromEntries(items.map(i => [i.item_id, i.name]));
  }

  function connectSocket() {
    socket = io();
    socket.on('connect', () => {
      socket.emit('join_trade', { tradeId });
    });
    socket.on('trade_state', (s) => {
      state = s;
      document.getElementById('trade-panels').style.display = '';
      render();
    });
    socket.on('trade_complete', ({ message }) => {
      toast(message ?? 'Trade complete!', true);
      if (state) { state = { ...state, status: 'complete' }; render(); }
    });
    socket.on('trade_error', ({ message }) => {
      toast(message ?? 'Trade failed.', false);
      if (state) { state = { ...state, status: 'cancelled' }; render(); }
    });
  }

  function setStatus(msg, kind) {
    const el = document.getElementById('trade-status');
    el.textContent = msg;
    el.className = `trade-status ${kind ?? ''}`;
  }

  function render() {
    renderYourPanel();
    renderTheirOffer();
    renderControls();
  }

  function renderYourPanel() {
    const container = document.getElementById('your-inventory');
    document.getElementById('your-name').textContent = state?.you?.charName ? `· ${state.you.charName}` : '';
    if (items.length === 0) {
      container.innerHTML = '<p class="trade-empty">Your inventory is empty.</p>';
      return;
    }
    const locked = state?.you?.locked;
    container.innerHTML = items.map(i => {
      const offerQty = myOffer[i.item_id] ?? 0;
      const minus = locked || offerQty <= 0;
      const plus  = locked || offerQty >= i.quantity;
      return `<div class="trade-row${offerQty > 0 ? ' offering' : ''}">
        <span class="trade-row-name">${esc(i.name)}</span>
        <span class="trade-row-have">×${i.quantity.toLocaleString()}</span>
        <div class="trade-qty${locked ? ' disabled' : ''}">
          <button data-action="dec" data-id="${esc(i.item_id)}" ${minus ? 'disabled' : ''}>−</button>
          <span class="trade-qty-val">${offerQty}</span>
          <button data-action="inc" data-id="${esc(i.item_id)}" ${plus ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const delta = btn.dataset.action === 'inc' ? 1 : -1;
        adjustOffer(id, delta);
      });
    });
  }

  function renderTheirOffer() {
    const container = document.getElementById('their-offer');
    document.getElementById('their-name').textContent = state?.them?.charName ? `· ${state.them.charName}` : '';
    const offer = state?.them?.offer ?? [];
    if (offer.length === 0) {
      container.innerHTML = '<p class="trade-empty">Nothing offered yet.</p>';
      return;
    }
    container.innerHTML = offer.map(o => `
      <div class="trade-row offering">
        <span class="trade-row-name">${esc(nameById[o.itemId] ?? o.itemId)}</span>
        <span class="trade-row-have">×${o.quantity.toLocaleString()}</span>
      </div>
    `).join('');
  }

  function renderControls() {
    if (!state) return;
    const youLocked  = state.you?.locked;
    const themLocked = state.them?.locked;
    const bothLocked = youLocked && themLocked;
    const done = state.status === 'complete' || state.status === 'cancelled';

    if (state.status === 'waiting') {
      setStatus(`Waiting for ${state.them?.charName ?? 'the other player'} to join…`);
    } else if (state.status === 'cancelled') {
      setStatus('Trade cancelled.', 'err');
    } else if (state.status === 'complete') {
      setStatus('Trade complete!', 'ok');
    } else {
      const parts = [];
      if (youLocked)  parts.push('You are locked in.');
      if (themLocked) parts.push(`${state.them?.charName ?? 'They'} is locked in.`);
      setStatus(parts.join(' ') || 'Adjust your offer, then lock in.');
    }

    const lockBtn    = document.getElementById('lock-btn');
    const confirmBtn = document.getElementById('confirm-btn');
    const cancelBtn  = document.getElementById('cancel-btn');

    lockBtn.textContent = youLocked ? 'Unlock' : 'Lock In';
    lockBtn.style.display    = done ? 'none' : '';
    confirmBtn.style.display = (bothLocked && !state.you?.confirmed && !done) ? '' : 'none';
    cancelBtn.style.display  = done ? 'none' : '';
  }

  function adjustOffer(itemId, delta) {
    const item = items.find(i => i.item_id === itemId);
    if (!item || state?.you?.locked) return;
    const current = myOffer[itemId] ?? 0;
    myOffer[itemId] = Math.max(0, Math.min(item.quantity, current + delta));
    renderYourPanel();
    socket.emit('trade_offer', {
      tradeId,
      offer: Object.entries(myOffer)
        .filter(([, q]) => q > 0)
        .map(([itemId, quantity]) => ({ itemId, quantity })),
    });
  }

  function doLock()    { socket?.emit('trade_lock',    { tradeId }); }
  function doConfirm() { socket?.emit('trade_confirm', { tradeId }); }
  function doCancel()  { socket?.emit('trade_cancel',  { tradeId }); }

  function toast(msg, ok) {
    const el = document.getElementById('trade-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    if (socket) {
      try { socket.disconnect(); } catch (_) {}
      socket = null;
    }
    state = null; items = []; myOffer = {}; nameById = {}; tradeId = null;
  }

  window.Views = window.Views ?? {};
  window.Views.trade = { mount, unmount };
})();
