// View: Trade — two-panel real-time trade for items, weapons, and korel.
(function() {
  let socket = null;
  let state  = null;
  let tradeId = null;
  let items   = [];                     // [{ item_id, name, quantity }]
  let weapons = [];                     // [{ id, name, bonus_count, equipped }]
  let myKorel = 0;                      // current balance
  let myOffer = { items: {}, weapons: new Set(), korel: 0 };

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
            <h2 class="trade-panel-title"><span id="your-panel-title">Your Offer</span> <span id="your-name" class="trade-panel-sub"></span></h2>
            <div id="your-offer-body" class="trade-offer-body"></div>
          </section>
          <div class="trade-divider">
            <button id="lock-btn" class="trade-btn trade-btn-lock">Lock In</button>
            <button id="confirm-btn" class="trade-btn trade-btn-confirm" style="display:none">Confirm Trade</button>
            <button id="cancel-btn" class="trade-btn trade-btn-cancel">Cancel</button>
          </div>
          <section class="trade-panel">
            <h2 class="trade-panel-title"><span id="their-panel-title">Their Offer</span> <span id="their-name" class="trade-panel-sub"></span></h2>
            <div id="their-offer-body" class="trade-offer-body"></div>
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
    items   = (data.items ?? []).filter(i => i.quantity > 0);
    weapons = (data.weapons ?? []);
    myKorel = data.korel ?? 0;
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
      // Refresh the header so the korel total reflects the trade outcome.
      if (typeof mountLayout === 'function') mountLayout().catch(() => {});
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

  // ---- Your panel ----

  function renderYourPanel() {
    const root = document.getElementById('your-offer-body');
    const done = state?.status === 'complete' || state?.status === 'cancelled';
    document.getElementById('your-panel-title').textContent = done ? 'You Gave' : 'Your Offer';
    document.getElementById('your-name').textContent = state?.you?.charName ? `· ${state.you.charName}` : '';
    const locked = state?.you?.locked;

    // If the trade is complete, show the static "you gave" view (mirroring "their" panel).
    if (done) {
      root.innerHTML = renderCompletedSide(state.you?.offer);
      return;
    }

    // Preserve focus + caret position on any input across re-renders (korel
    // input or per-item qty input). The id is stable per row, so capturing
    // the active element's id is enough.
    const active     = document.activeElement;
    const focusedId  = (active?.tagName === 'INPUT' && active.id?.startsWith('your-')) ? active.id : null;

    const itemsHtml = renderYourItems(locked);
    const weaponsHtml = renderYourWeapons(locked);
    const korelHtml = renderYourKorel(locked);

    root.innerHTML = `
      <div class="trade-section">
        <h3 class="trade-section-label">Korel</h3>
        ${korelHtml}
      </div>
      <div class="trade-section">
        <h3 class="trade-section-label">Items</h3>
        ${itemsHtml}
      </div>
      <div class="trade-section">
        <h3 class="trade-section-label">Weapons</h3>
        ${weaponsHtml}
      </div>
    `;

    // Wire up controls (re-bound on every render)
    root.querySelectorAll('button[data-item-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = btn.dataset.itemAction === 'inc' ? 1 : -1;
        adjustItem(btn.dataset.id, delta);
      });
    });
    root.querySelectorAll('button[data-weapon-id]').forEach(btn => {
      btn.addEventListener('click', () => toggleWeapon(btn.dataset.weaponId));
    });
    root.querySelectorAll('input.trade-qty-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const itemId = inp.dataset.id;
        const owned  = items.find(i => i.item_id === itemId)?.quantity ?? 0;
        const cleaned = inp.value.replace(/\D/g, '');
        const clamped = Math.max(0, Math.min(owned, parseInt(cleaned, 10) || 0));
        if (String(clamped) !== inp.value) inp.value = String(clamped);
        setItem(itemId, clamped);
      });
    });
    const korelInput = root.querySelector('#your-korel-input');
    if (korelInput) {
      korelInput.addEventListener('input', () => {
        const cleaned = korelInput.value.replace(/\D/g, '');
        const clamped = Math.max(0, Math.min(myKorel, parseInt(cleaned, 10) || 0));
        if (String(clamped) !== korelInput.value) korelInput.value = String(clamped);
        setKorel(clamped);
      });
    }

    // Restore focus to whichever input had it, cursor at end of value.
    if (focusedId) {
      const el = document.getElementById(focusedId);
      if (el) {
        el.focus();
        const end = el.value.length;
        try { el.setSelectionRange(end, end); } catch (_) {}
      }
    }
  }

  function renderCompletedSide(offer) {
    offer = offer ?? { items: [], weapons: [], korel: 0 };
    const isEmpty = (offer.items?.length ?? 0) === 0 && (offer.weapons?.length ?? 0) === 0 && (offer.korel ?? 0) === 0;
    if (isEmpty) return '<p class="trade-empty">Nothing.</p>';
    const parts = [];
    if ((offer.korel ?? 0) > 0) {
      parts.push(`<div class="trade-section"><h3 class="trade-section-label">Korel</h3>
        <div class="trade-row offering"><span class="trade-row-name">${offer.korel.toLocaleString()} korel</span></div>
      </div>`);
    }
    if ((offer.items?.length ?? 0) > 0) {
      const rows = offer.items.map(o => `
        <div class="trade-row offering">
          <span class="trade-row-name">${esc(o.name ?? o.itemId)}</span>
          <span class="trade-row-have">×${o.quantity.toLocaleString()}</span>
        </div>
      `).join('');
      parts.push(`<div class="trade-section"><h3 class="trade-section-label">Items</h3>${rows}</div>`);
    }
    if ((offer.weapons?.length ?? 0) > 0) {
      const rows = offer.weapons.map(w => `
        <div class="trade-row offering"><span class="trade-row-name">${esc(w.name ?? '(weapon)')}${w.bonus > 0 ? ` <span class="trade-bonus">+${w.bonus}</span>` : ''}</span></div>
      `).join('');
      parts.push(`<div class="trade-section"><h3 class="trade-section-label">Weapons</h3>${rows}</div>`);
    }
    return parts.join('');
  }

  function renderYourItems(locked) {
    if (items.length === 0) return '<p class="trade-empty">No items to offer.</p>';
    return items.map(i => {
      const qty = myOffer.items[i.item_id] ?? 0;
      const minus = locked || qty <= 0;
      const plus  = locked || qty >= i.quantity;
      const inputId = `your-item-input-${esc(i.item_id)}`;
      return `<div class="trade-row${qty > 0 ? ' offering' : ''}">
        <span class="trade-row-name">${esc(i.name)}</span>
        <span class="trade-row-have">×${i.quantity.toLocaleString()}</span>
        <div class="trade-qty${locked ? ' disabled' : ''}">
          <button data-item-action="dec" data-id="${esc(i.item_id)}" ${minus ? 'disabled' : ''}>−</button>
          <input class="trade-qty-input" type="text" inputmode="numeric" pattern="[0-9]*"
            autocomplete="off" maxlength="6"
            id="${inputId}" data-id="${esc(i.item_id)}"
            value="${qty}" ${locked ? 'disabled' : ''}>
          <button data-item-action="inc" data-id="${esc(i.item_id)}" ${plus ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderYourWeapons(locked) {
    if (weapons.length === 0) return '<p class="trade-empty">No weapons to offer.</p>';
    return weapons.map(w => {
      const selected = myOffer.weapons.has(w.id);
      const disabled = locked || w.equipped;
      const label = w.equipped ? 'equipped' : (selected ? 'remove' : 'add');
      const note  = w.equipped ? '<span class="trade-row-meta">unequip to trade</span>' : '';
      return `<div class="trade-row${selected ? ' offering' : ''}${w.equipped ? ' disabled-row' : ''}">
        <span class="trade-row-name">${esc(w.name)}${w.bonus_count > 0 ? ` <span class="trade-bonus">+${w.bonus_count}</span>` : ''}</span>
        ${note}
        <button class="trade-weapon-btn" data-weapon-id="${esc(w.id)}" ${disabled ? 'disabled' : ''}>${label}</button>
      </div>`;
    }).join('');
  }

  function renderYourKorel(locked) {
    return `<div class="trade-korel-row">
      <input id="your-korel-input" type="text" inputmode="numeric" pattern="[0-9]*"
        autocomplete="off" maxlength="9" value="${myOffer.korel}" ${locked ? 'disabled' : ''}>
      <span class="trade-row-have">/ ${myKorel.toLocaleString()} korel</span>
    </div>`;
  }

  // ---- Their panel ----

  function renderTheirOffer() {
    const root = document.getElementById('their-offer-body');
    const done = state?.status === 'complete' || state?.status === 'cancelled';
    document.getElementById('their-panel-title').textContent = done ? 'You Received' : 'Their Offer';
    document.getElementById('their-name').textContent = state?.them?.charName ? `· ${state.them.charName}` : '';
    const offer = state?.them?.offer ?? { items: [], weapons: [], korel: 0 };

    if (done) {
      root.innerHTML = renderCompletedSide(offer);
      return;
    }

    const korelRow = (offer.korel ?? 0) > 0
      ? `<div class="trade-row offering"><span class="trade-row-name">${offer.korel.toLocaleString()} korel</span></div>`
      : '<p class="trade-empty">No korel.</p>';

    const weaponRows = (offer.weapons ?? []).map(w => `
      <div class="trade-row offering">
        <span class="trade-row-name">${esc(w.name ?? '(weapon)')}${w.bonus > 0 ? ` <span class="trade-bonus">+${w.bonus}</span>` : ''}</span>
      </div>
    `).join('') || '<p class="trade-empty">No weapons.</p>';

    const itemRows = (offer.items ?? []).map(o => `
      <div class="trade-row offering">
        <span class="trade-row-name">${esc(o.name ?? o.itemId)}</span>
        <span class="trade-row-have">×${o.quantity.toLocaleString()}</span>
      </div>
    `).join('') || '<p class="trade-empty">No items.</p>';

    root.innerHTML = `
      <div class="trade-section">
        <h3 class="trade-section-label">Korel</h3>
        ${korelRow}
      </div>
      <div class="trade-section">
        <h3 class="trade-section-label">Items</h3>
        ${itemRows}
      </div>
      <div class="trade-section">
        <h3 class="trade-section-label">Weapons</h3>
        ${weaponRows}
      </div>
    `;
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
      const youConfirmed  = state.you?.confirmed;
      const themConfirmed = state.them?.confirmed;
      const themName      = state.them?.charName ?? 'They';
      const parts = [];
      if (youConfirmed)        parts.push('You confirmed.');
      else if (youLocked)      parts.push('You are locked in.');
      if (themConfirmed)       parts.push(`${themName} confirmed.`);
      else if (themLocked)     parts.push(`${themName} is locked in.`);
      if (bothLocked && (!youConfirmed || !themConfirmed)) {
        parts.push(youConfirmed ? `Waiting for ${themName} to confirm…` : 'Confirm to complete.');
      }
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

  // ---- Mutators ----

  function adjustItem(itemId, delta) {
    if (state?.you?.locked) return;
    const item = items.find(i => i.item_id === itemId);
    if (!item) return;
    const current = myOffer.items[itemId] ?? 0;
    setItem(itemId, current + delta);
    renderYourPanel();
  }

  function setItem(itemId, qty) {
    if (state?.you?.locked) return;
    const item = items.find(i => i.item_id === itemId);
    if (!item) return;
    myOffer.items[itemId] = Math.max(0, Math.min(item.quantity, Math.floor(qty)));
    sendOffer();
    // No re-render here — typing into the input must keep focus. Buttons
    // call adjustItem which re-renders explicitly for the visual update.
  }

  function toggleWeapon(weaponId) {
    if (state?.you?.locked) return;
    const w = weapons.find(x => x.id === weaponId);
    if (!w || w.equipped) return;
    if (myOffer.weapons.has(weaponId)) myOffer.weapons.delete(weaponId);
    else myOffer.weapons.add(weaponId);
    sendOffer();
    renderYourPanel();
  }

  function setKorel(amount) {
    if (state?.you?.locked) return;
    myOffer.korel = Math.max(0, Math.min(myKorel, Math.floor(amount)));
    sendOffer();
    // Don't re-render — would steal focus from the input. Only update on lock/state change.
  }

  function sendOffer() {
    if (!socket) return;
    socket.emit('trade_offer', {
      tradeId,
      offer: {
        items: Object.entries(myOffer.items)
          .filter(([, q]) => q > 0)
          .map(([itemId, quantity]) => ({ itemId, quantity })),
        weapons: Array.from(myOffer.weapons).map(id => {
          const w = weapons.find(x => x.id === id);
          return { id, name: w?.name ?? 'weapon', bonus: w?.bonus_count ?? 0 };
        }),
        korel:   myOffer.korel,
      },
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
    state = null;
    items = []; weapons = []; myKorel = 0;
    myOffer = { items: {}, weapons: new Set(), korel: 0 };
    tradeId = null;
  }

  window.Views = window.Views ?? {};
  window.Views.trade = { mount, unmount };
})();
