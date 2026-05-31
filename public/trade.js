const params  = new URLSearchParams(location.search);
const auth    = params.get('auth') ?? localStorage.getItem('trade_auth') ?? '';
const tradeId = location.pathname.split('/').pop();

if (auth) localStorage.setItem('trade_auth', auth);

let socket    = null;
let state     = null;
let inventory = [];  // { itemId, name, quantity }
let myOffer   = {};  // itemId → quantity

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

async function loadInventory() {
  const res = await fetch('/api/craft', { headers: { Authorization: `Bearer ${auth}` } });
  if (!res.ok) return;
  const data = await res.json();
  const ITEMS = data.inventory ?? {};
  // craft endpoint gives us inventory as {itemId: quantity}
  // we need names — fetch from weapon-stats items list isn't ideal, so use item IDs for now
  // but craft also returns item table data; let's use the shop endpoint to get names
  // simplest: just use the inventory map and show item IDs (we'll label via ITEMS map if available)
  inventory = Object.entries(ITEMS)
    .filter(([, qty]) => (qty as number) > 0)
    .map(([itemId, qty]) => ({ itemId, quantity: qty as number }));
  renderYourPanel();
}

function renderYourPanel() {
  const container = document.getElementById('your-inventory');
  if (inventory.length === 0) {
    container.innerHTML = '<p class="empty">Your inventory is empty.</p>';
    return;
  }
  container.innerHTML = inventory.map(item => {
    const offerQty = myOffer[item.itemId] ?? 0;
    const locked   = state?.you?.locked;
    return `<div class="inv-row">
      <span class="inv-name">${esc(item.itemId)}</span>
      <span class="inv-have">×${item.quantity}</span>
      <div class="qty-ctrl ${locked ? 'disabled' : ''}">
        <button onclick="adjustOffer('${item.itemId}', -1)" ${locked || offerQty <= 0 ? 'disabled' : ''}>−</button>
        <span class="qty-val">${offerQty}</span>
        <button onclick="adjustOffer('${item.itemId}', 1)" ${locked || offerQty >= item.quantity ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  }).join('');
}

function renderTheirOffer() {
  const container = document.getElementById('their-offer');
  const offer = state?.them?.offer ?? [];
  if (offer.length === 0) {
    container.innerHTML = '<p class="empty">Nothing offered yet.</p>';
    return;
  }
  container.innerHTML = offer.map(o =>
    `<div class="inv-row"><span class="inv-name">${esc(o.itemId)}</span><span class="inv-have">×${o.quantity}</span></div>`
  ).join('');
}

function renderStatus() {
  if (!state) return;
  const youLocked  = state.you?.locked;
  const themLocked = state.them?.locked;
  const bothLocked = youLocked && themLocked;

  const statusLine = document.getElementById('status-line');
  if (state.status === 'waiting') {
    statusLine.textContent = 'Waiting for the other player to connect...';
  } else if (state.status === 'cancelled') {
    statusLine.textContent = 'Trade cancelled.';
  } else if (state.status === 'complete') {
    statusLine.textContent = 'Trade complete!';
  } else {
    const parts = [];
    if (youLocked) parts.push('You are locked in.');
    if (themLocked) parts.push(`${esc(state.them?.charName ?? 'They')} is locked in.`);
    statusLine.textContent = parts.join(' ') || 'Select items to offer.';
  }

  const lockBtn    = document.getElementById('lock-btn');
  const confirmBtn = document.getElementById('confirm-btn');
  const cancelBtn  = document.getElementById('cancel-btn');
  const done = state.status === 'complete' || state.status === 'cancelled';

  lockBtn.textContent = youLocked ? 'Unlock' : 'Lock In';
  lockBtn.style.display  = done ? 'none' : '';
  confirmBtn.style.display = (bothLocked && !state.you?.confirmed && !done) ? '' : 'none';
  cancelBtn.style.display  = done ? 'none' : '';
}

function applyState(newState) {
  state = newState;
  document.getElementById('your-name').textContent = state.you?.charName ? `(${state.you.charName})` : '';
  document.getElementById('their-name').textContent = state.them?.charName ? `(${state.them.charName})` : '';
  renderYourPanel();
  renderTheirOffer();
  renderStatus();
}

function adjustOffer(itemId, delta) {
  const item = inventory.find(i => i.itemId === itemId);
  if (!item) return;
  const current = myOffer[itemId] ?? 0;
  myOffer[itemId] = Math.max(0, Math.min(item.quantity, current + delta));
  renderYourPanel();
  socket.emit('trade_offer', {
    tradeId, auth,
    offer: Object.entries(myOffer).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity })),
  });
}

function doLock() {
  socket.emit('trade_lock', { tradeId, auth });
}

function doConfirm() {
  socket.emit('trade_confirm', { tradeId, auth });
}

function doCancel() {
  socket.emit('trade_cancel', { tradeId, auth });
}

async function init() {
  if (!auth) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('auth-error').style.display = 'flex';
    return;
  }

  await loadInventory();

  socket = io();
  socket.on('connect', () => {
    socket.emit('join_trade', { tradeId, auth });
  });

  socket.on('trade_state', async (s) => {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    if (!window._layoutMounted) {
      await mountLayout({ title: 'Trade' });
      window._layoutMounted = true;
    }
    applyState(s);
  });

  window.onLayoutChange = async () => { await mountLayout({ title: 'Trade' }); };

  socket.on('trade_complete', ({ message }) => {
    showToast(message);
    applyState({ ...state, status: 'complete' });
  });

  socket.on('trade_error', ({ message }) => {
    showToast(message);
    applyState({ ...state, status: 'cancelled' });
  });
}

init();
