const shopKey = location.pathname.split('/').pop();
let data     = null;
let openBuy  = null;
let openSell = null;

// ---- Auth ----

function getToken() { return localStorage.getItem('shop_auth') ?? ''; }

function authHeaders(json = false) {
  const h = { 'Authorization': `Bearer ${getToken()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// On first visit via Discord link, persist the token and clean the URL
(function initAuth() {
  const params = new URLSearchParams(location.search);
  const auth   = params.get('auth');
  if (auth) {
    localStorage.setItem('shop_auth', auth);
    history.replaceState(null, '', location.pathname);
  }
})();

// ---- Load ----

async function load() {
  if (!getToken()) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('auth-error').style.display = 'flex';
    return;
  }
  const res = await fetch(`/api/shop/${shopKey}`, { headers: authHeaders() });
  if (res.status === 401) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('auth-error').style.display = 'flex';
    return;
  }
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

// ---- Render ----

function render() {
  document.getElementById('shop-name').textContent = data.shopName;
  document.getElementById('npc-line').textContent  = `${data.npc} · ${data.title}`;
  document.getElementById('korel-val').textContent  = data.korel.toLocaleString();
  document.getElementById('greeting').textContent   = `"${data.greeting}"`;
  renderBuy();
  renderSell();
}

function renderBuy() {
  const forSale = data.items.filter(i => i.buy != null);
  const list = document.getElementById('buy-list');
  if (forSale.length === 0) {
    list.innerHTML = '<p class="empty">Nothing for sale right now.</p>';
    return;
  }
  list.innerHTML = '';
  for (const item of forSale) {
    const oos    = item.stock === 0;
    const isOpen = openBuy === item.id;
    const el     = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="item-row${isOpen ? ' open' : ''}" onclick="toggleBuy('${item.id}')">
        <span class="item-name${oos ? ' dim' : ''}">${esc(item.name)}</span>
        <span class="item-price ${oos ? 'price-dim' : 'price-buy'}">${oos ? 'out of stock' : `${item.buy} korel`}</span>
      </div>
      ${isOpen ? `
        <div class="item-detail">
          <p class="item-desc">${esc(item.description)}</p>
          <p class="stock-line">${item.stock} in stock</p>
          ${oos ? '<p class="unavailable">Check back when restocked.</p>' : `
            <div class="controls">
              <div class="qty-wrap">
                <button class="qty-step" onclick="adj('b${item.id}', -1, ${item.stock})">−</button>
                <input  type="number" id="qty-b${item.id}" class="qty-input" value="1" min="1" max="${item.stock}">
                <button class="qty-step" onclick="adj('b${item.id}', 1, ${item.stock})">+</button>
              </div>
              <button class="btn btn-buy" onclick="doBuy('${item.id}')">Buy</button>
            </div>`}
        </div>` : ''}
    `;
    list.appendChild(el);
  }
}

function renderSell() {
  const sellable = data.inventory.filter(inv => {
    const si = data.items.find(i => i.id === inv.item_id);
    return si && si.sell != null;
  });
  const list = document.getElementById('sell-list');
  if (sellable.length === 0) {
    list.innerHTML = "<p class='empty'>Nothing in your inventory to sell here.</p>";
    return;
  }
  list.innerHTML = '';
  for (const inv of sellable) {
    const si     = data.items.find(i => i.id === inv.item_id);
    const full   = si.stock >= si.stock_max;
    const isOpen = openSell === inv.item_id;
    const el     = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="item-row${isOpen ? ' open' : ''}" onclick="toggleSell('${inv.item_id}')">
        <span class="item-name${full ? ' dim' : ''}">${esc(inv.name)}<span class="qty-tag">×${inv.quantity}</span></span>
        <span class="item-price ${full ? 'price-dim' : 'price-sell'}">${full ? 'not buying' : `${si.sell} korel`}</span>
      </div>
      ${isOpen ? `
        <div class="item-detail">
          <p class="item-desc">${esc(inv.description)}</p>
          ${full ? '<p class="unavailable">Shop is fully stocked.</p>' : `
            <div class="controls">
              <div class="qty-wrap">
                <button class="qty-step" onclick="adj('s${inv.item_id}', -1, ${inv.quantity})">−</button>
                <input  type="number" id="qty-s${inv.item_id}" class="qty-input" value="1" min="1" max="${inv.quantity}">
                <button class="qty-step" onclick="adj('s${inv.item_id}', 1, ${inv.quantity})">+</button>
              </div>
              <button class="btn btn-sell" onclick="doSell('${inv.item_id}')">Sell</button>
              <button class="btn btn-all"  onclick="doSellAll('${inv.item_id}')">All</button>
            </div>`}
        </div>` : ''}
    `;
    list.appendChild(el);
  }
}

function toggleBuy(id)  { openBuy  = openBuy  === id ? null : id; renderBuy();  }
function toggleSell(id) { openSell = openSell === id ? null : id; renderSell(); }

function adj(id, delta, max) {
  const el  = document.getElementById(`qty-${id}`);
  const val = Math.max(1, Math.min(max, (parseInt(el.value, 10) || 1) + delta));
  el.value  = val;
}

// ---- Toast ----

function toast(msg, ok) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${ok ? 'ok' : 'err'}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 4500);
}

// ---- Transactions ----

async function refresh() {
  const res = await fetch(`/api/shop/${shopKey}`, { headers: authHeaders() });
  if (res.ok) { data = await res.json(); render(); }
}

async function doBuy(itemId) {
  const qty = parseInt(document.getElementById(`qty-b${itemId}`).value, 10) || 1;
  const res = await fetch(`/api/shop/${shopKey}/buy`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({ itemId, quantity: qty }),
  });
  const r = await res.json();
  toast(r.message ?? r.error, r.success !== false);
  if (r.success) { openBuy = null; await refresh(); }
}

async function doSell(itemId) {
  const qty = parseInt(document.getElementById(`qty-s${itemId}`).value, 10) || 1;
  const res = await fetch(`/api/shop/${shopKey}/sell`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({ itemId, quantity: qty }),
  });
  const r = await res.json();
  toast(r.message ?? r.error, r.success !== false);
  if (r.success) { openSell = null; await refresh(); }
}

async function doSellAll(itemId) {
  const res = await fetch(`/api/shop/${shopKey}/sell-all`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({ itemId }),
  });
  const r = await res.json();
  toast(r.message ?? r.error, r.success !== false);
  if (r.success) { openSell = null; await refresh(); }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

load();
