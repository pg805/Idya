// View: Shop — buy/sell at a specific shop.
(function() {
  let shopKey  = null;
  let data     = null;
  let openBuy  = null;
  let openSell = null;
  let rootEl   = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function mount(root, params) {
    rootEl  = root;
    shopKey = params.shopKey;
    openBuy = openSell = null;
    setLayoutTitle('Shop');
    root.innerHTML = `
      <div id="shop-subhead">
        <p id="shop-name-line"></p>
        <p id="shop-greeting"></p>
      </div>
      <main class="shop-panels">
        <section class="shop-panel">
          <div class="shop-panel-label">For Sale</div>
          <div id="shop-buy-list"></div>
        </section>
        <section class="shop-panel">
          <div class="shop-panel-label">Your Inventory</div>
          <div id="shop-sell-list"></div>
        </section>
      </main>
      <div id="shop-toast"></div>
    `;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await loadData();
  }

  function layoutChangedHandler() { if (data) loadData(); }

  async function loadData() {
    const res = await fetch(`/api/shop/${shopKey}`);
    if (!res.ok) {
      rootEl.innerHTML = `<div class="splash"><p>Shop not found.</p></div>`;
      return;
    }
    data = await res.json();
    await render();
  }

  async function render() {
    setLayoutTitle(data.shopName);
    document.getElementById('shop-name-line').textContent = `${data.npc} · ${data.title}`;
    document.getElementById('shop-greeting').textContent  = `"${data.greeting}"`;
    renderBuy();
    renderSell();
  }

  function renderBuy() {
    const forSale = data.items.filter(i => i.buy != null);
    const list = document.getElementById('shop-buy-list');
    if (forSale.length === 0) {
      list.innerHTML = '<p class="shop-empty">Nothing for sale right now.</p>';
      return;
    }
    list.innerHTML = '';
    for (const item of forSale) {
      const oos       = !item.infinite && item.stock === 0;
      const isOpen    = openBuy === item.id;
      const stockText = item.infinite ? 'Always in stock' : `${item.stock} in stock`;
      const maxQty    = item.infinite ? 9999 : item.stock;
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.innerHTML = `
        <div class="shop-item-row${isOpen ? ' open' : ''}" onclick="Views.shop.toggleBuy('${item.id}')">
          <span class="shop-item-name${oos ? ' dim' : ''}">${esc(item.name)}</span>
          <span class="shop-item-price ${oos ? 'price-dim' : 'price-buy'}">${oos ? 'out of stock' : `${item.buy} korel`}</span>
        </div>
        ${isOpen ? `
          <div class="shop-item-detail">
            <p class="shop-item-desc">${esc(item.description)}</p>
            <p class="shop-stock-line">${stockText}</p>
            ${oos ? '<p class="shop-unavailable">Check back when restocked.</p>' : `
              <div class="shop-controls">
                <div class="shop-qty-wrap">
                  <button class="shop-qty-step" onclick="Views.shop.adj('b${item.id}', -1, ${maxQty})">−</button>
                  <input  type="number" id="qty-b${item.id}" class="shop-qty-input" value="1" min="1" max="${maxQty}">
                  <button class="shop-qty-step" onclick="Views.shop.adj('b${item.id}', 1, ${maxQty})">+</button>
                </div>
                <button class="shop-btn shop-btn-buy" onclick="Views.shop.doBuy('${item.id}')">Buy</button>
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
    const list = document.getElementById('shop-sell-list');
    if (sellable.length === 0) {
      list.innerHTML = "<p class='shop-empty'>Nothing in your inventory to sell here.</p>";
      return;
    }
    list.innerHTML = '';
    for (const inv of sellable) {
      const si     = data.items.find(i => i.id === inv.item_id);
      const full   = si.stock >= si.stock_max;
      const isOpen = openSell === inv.item_id;
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.innerHTML = `
        <div class="shop-item-row${isOpen ? ' open' : ''}" onclick="Views.shop.toggleSell('${inv.item_id}')">
          <span class="shop-item-name${full ? ' dim' : ''}">${esc(inv.name)}<span class="shop-qty-tag">×${inv.quantity}</span></span>
          <span class="shop-item-price ${full ? 'price-dim' : 'price-sell'}">${full ? 'not buying' : `${si.sell} korel`}</span>
        </div>
        ${isOpen ? `
          <div class="shop-item-detail">
            <p class="shop-item-desc">${esc(inv.description)}</p>
            ${full ? '<p class="shop-unavailable">Shop is fully stocked.</p>' : `
              <div class="shop-controls">
                <div class="shop-qty-wrap">
                  <button class="shop-qty-step" onclick="Views.shop.adj('s${inv.item_id}', -1, ${inv.quantity})">−</button>
                  <input  type="number" id="qty-s${inv.item_id}" class="shop-qty-input" value="1" min="1" max="${inv.quantity}">
                  <button class="shop-qty-step" onclick="Views.shop.adj('s${inv.item_id}', 1, ${inv.quantity})">+</button>
                </div>
                <button class="shop-btn shop-btn-sell" onclick="Views.shop.doSell('${inv.item_id}')">Sell</button>
                <button class="shop-btn shop-btn-all"  onclick="Views.shop.doSellAll('${inv.item_id}')">All</button>
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

  function toast(msg, ok) {
    const el = document.getElementById('shop-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  async function doBuy(itemId) {
    const qty = parseInt(document.getElementById(`qty-b${itemId}`).value, 10) || 1;
    const res = await fetch(`/api/shop/${shopKey}/buy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, quantity: qty }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { openBuy = null; await mountLayout(); }
  }

  async function doSell(itemId) {
    const qty = parseInt(document.getElementById(`qty-s${itemId}`).value, 10) || 1;
    const res = await fetch(`/api/shop/${shopKey}/sell`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, quantity: qty }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { openSell = null; await mountLayout(); }
  }

  async function doSellAll(itemId) {
    const res = await fetch(`/api/shop/${shopKey}/sell-all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) { openSell = null; await mountLayout(); }
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    data = null; openBuy = null; openSell = null; rootEl = null;
  }

  // After buy/sell, refresh layout (korel changed) — triggers layout-changed event → re-renders shop
  async function refreshAfterMutation() {
    await mountLayout();
  }

  // expose handlers for inline onclick
  window.Views = window.Views ?? {};
  window.Views.shop = { mount, unmount, toggleBuy, toggleSell, adj, doBuy, doSell, doSellAll };

  window.showToast = (msg) => toast(msg, true);
})();
