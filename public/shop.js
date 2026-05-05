const sessionId = location.pathname.split('/').pop();
let data     = null;
let tab      = 'browse';
let expanded = null;

async function load() {
  const res = await fetch(`/api/shop/${sessionId}`);
  if (!res.ok) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('session-error').style.display = 'flex';
    return;
  }
  data = await res.json();
  document.title = data.shopName;
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  render();
}

function render() {
  document.getElementById('npc-name').textContent     = `${data.npc} — ${data.title}`;
  document.getElementById('korel-display').textContent = `${data.korel.toLocaleString()} korel`;
  document.getElementById('shop-greeting').textContent = `"${data.greeting}"`;
  tab === 'browse' ? renderBrowse() : renderSell();
}

function renderBrowse() {
  const forSale = data.items.filter(i => i.buy != null);
  const list = document.getElementById('item-list');
  if (forSale.length === 0) {
    list.innerHTML = '<p class="empty">Nothing for sale right now.</p>';
    return;
  }
  list.innerHTML = '';
  for (const item of forSale) {
    const oos    = item.stock === 0;
    const isOpen = expanded === item.id;
    const card   = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-row" onclick="toggle('${item.id}')">
        <span class="item-name${oos ? ' dim' : ''}">${esc(item.name)}</span>
        <span class="item-meta">${oos ? 'out of stock' : `${item.buy} korel · ${item.stock} left`}</span>
      </div>
      ${isOpen ? `
        <div class="item-detail">
          <p class="item-desc">${esc(item.description)}</p>
          ${oos
            ? '<p class="empty-note">Come back when stock is replenished.</p>'
            : `<div class="controls">
                <input type="number" id="qty-${item.id}" class="qty-input" min="1" max="${item.stock}" value="1">
                <button class="primary" onclick="doBuy('${item.id}')">Buy</button>
               </div>`}
        </div>` : ''}
    `;
    list.appendChild(card);
  }
}

function renderSell() {
  const sellable = data.inventory.filter(inv => {
    const si = data.items.find(i => i.id === inv.item_id);
    return si && si.sell != null;
  });
  const list = document.getElementById('item-list');
  if (sellable.length === 0) {
    list.innerHTML = "<p class='empty'>You don't have anything this shop buys.</p>";
    return;
  }
  list.innerHTML = '';
  for (const inv of sellable) {
    const si     = data.items.find(i => i.id === inv.item_id);
    const full   = si.stock >= si.stock_max;
    const isOpen = expanded === inv.item_id;
    const card   = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-row" onclick="toggle('${inv.item_id}')">
        <span class="item-name${full ? ' dim' : ''}">${esc(inv.name)}</span>
        <span class="item-meta">${full ? 'not buying' : `${si.sell} korel ea · ×${inv.quantity}`}</span>
      </div>
      ${isOpen ? `
        <div class="item-detail">
          <p class="item-desc">${esc(inv.description)}</p>
          ${full
            ? '<p class="empty-note">Shop is fully stocked.</p>'
            : `<div class="controls">
                <input type="number" id="qty-${inv.item_id}" class="qty-input" min="1" max="${inv.quantity}" value="1">
                <button class="secondary" onclick="doSell('${inv.item_id}')">Sell</button>
                <button class="danger"    onclick="doSellAll('${inv.item_id}')">Sell All</button>
               </div>`}
        </div>` : ''}
    `;
    list.appendChild(card);
  }
}

function toggle(id) {
  expanded = expanded === id ? null : id;
  render();
}

function switchTab(t) {
  tab = t;
  expanded = null;
  document.getElementById('tab-browse').classList.toggle('active', t === 'browse');
  document.getElementById('tab-sell').classList.toggle('active', t === 'sell');
  render();
}

function showStatus(msg, ok) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = ok ? 'ok' : 'err';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
}

async function refresh() {
  const res = await fetch(`/api/shop/${sessionId}`);
  if (res.ok) { data = await res.json(); render(); }
}

async function doBuy(itemId) {
  const qty = parseInt(document.getElementById(`qty-${itemId}`).value, 10);
  if (!qty || qty < 1) return;
  const res = await fetch(`/api/shop/${sessionId}/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, quantity: qty }),
  });
  const r = await res.json();
  showStatus(r.message ?? r.error, r.success !== false);
  if (r.success) { expanded = null; await refresh(); }
}

async function doSell(itemId) {
  const qty = parseInt(document.getElementById(`qty-${itemId}`).value, 10);
  if (!qty || qty < 1) return;
  const res = await fetch(`/api/shop/${sessionId}/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, quantity: qty }),
  });
  const r = await res.json();
  showStatus(r.message ?? r.error, r.success !== false);
  if (r.success) { expanded = null; await refresh(); }
}

async function doSellAll(itemId) {
  const res = await fetch(`/api/shop/${sessionId}/sell-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
  const r = await res.json();
  showStatus(r.message ?? r.error, r.success !== false);
  if (r.success) { expanded = null; await refresh(); }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

load();
