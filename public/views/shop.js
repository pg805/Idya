// View: Shop — cart-based buy/sell.
(function() {
  let shopKey  = null;
  let data     = null;
  let cart     = { buys: {}, sells: {} };  // { itemId: quantity }
  let rootEl   = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getCartQty(side, itemId)     { return cart[side][itemId] ?? 0; }
  function setCartQty(side, itemId, q) {
    if (q <= 0) delete cart[side][itemId];
    else cart[side][itemId] = q;
    renderBuy(); renderSell(); renderCart();
  }
  function adjCart(side, itemId, delta, max) {
    const cur = getCartQty(side, itemId);
    const next = Math.max(0, Math.min(max, cur + delta));
    setCartQty(side, itemId, next);
  }

  async function mount(root, params) {
    rootEl  = root;
    shopKey = params.shopKey;
    cart    = { buys: {}, sells: {} };
    setLayoutTitle('Shop');
    root.innerHTML = `
      <div id="shop-view">
        <div id="shop-subhead">
          <div id="shop-subhead-inner">
            <p id="shop-name-line"></p>
            <p id="shop-greeting"></p>
          </div>
        </div>
        <div id="shop-scroll">
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
        </div>
        <div id="shop-cart"></div>
      </div>
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
    renderCart();
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
      const stockText = item.infinite ? 'Always in stock' : `${item.stock} in stock`;
      const maxQty    = item.infinite ? 9999 : item.stock;
      const qty       = getCartQty('buys', item.id);
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.innerHTML = `
        <div class="shop-item-row" title="${esc(item.description)}">
          <div class="shop-item-info">
            <span class="shop-item-name${oos ? ' dim' : ''}">${esc(item.name)}</span>
            <span class="shop-item-sub">${oos ? 'out of stock' : `${item.buy} korel · ${stockText}`}</span>
          </div>
          ${oos ? '' : `
            <div class="shop-cart-ctrl">
              <button class="shop-step" onclick="Views.shop.adjCart('buys', '${item.id}', -1, ${maxQty})" ${qty <= 0 ? 'disabled' : ''}>−</button>
              <span class="shop-step-val">${qty}</span>
              <button class="shop-step" onclick="Views.shop.adjCart('buys', '${item.id}', 1, ${maxQty})" ${qty >= maxQty ? 'disabled' : ''}>+</button>
            </div>`}
        </div>
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
      const si    = data.items.find(i => i.id === inv.item_id);
      const room  = Math.max(0, si.stock_max - si.stock);
      const maxQty = Math.min(inv.quantity, room);
      const qty   = getCartQty('sells', inv.item_id);
      const note  = room === 0
        ? 'shop is fully stocked'
        : `${si.sell} korel · own ${inv.quantity}`;
      const el = document.createElement('div');
      el.className = 'shop-item';
      el.innerHTML = `
        <div class="shop-item-row" title="${esc(inv.description)}">
          <div class="shop-item-info">
            <span class="shop-item-name${room === 0 ? ' dim' : ''}">${esc(inv.name)}</span>
            <span class="shop-item-sub">${esc(note)}</span>
          </div>
          ${room === 0 ? '' : `
            <div class="shop-cart-ctrl">
              <button class="shop-step" onclick="Views.shop.adjCart('sells', '${inv.item_id}', -1, ${maxQty})" ${qty <= 0 ? 'disabled' : ''}>−</button>
              <span class="shop-step-val">${qty}</span>
              <button class="shop-step" onclick="Views.shop.adjCart('sells', '${inv.item_id}', 1, ${maxQty})" ${qty >= maxQty ? 'disabled' : ''}>+</button>
            </div>`}
        </div>
      `;
      list.appendChild(el);
    }
  }

  function cartSummary() {
    let cost = 0, revenue = 0;
    const buyLines  = [];
    const sellLines = [];
    for (const [id, qty] of Object.entries(cart.buys)) {
      const item = data.items.find(i => i.id === id);
      if (!item) continue;
      const sub = item.buy * qty;
      cost += sub;
      buyLines.push({ id, name: item.name, qty, subtotal: sub, unit: item.buy });
    }
    for (const [id, qty] of Object.entries(cart.sells)) {
      const item = data.items.find(i => i.id === id);
      if (!item) continue;
      const sub = item.sell * qty;
      revenue += sub;
      sellLines.push({ id, name: item.name, qty, subtotal: sub, unit: item.sell });
    }
    return { cost, revenue, net: revenue - cost, buyLines, sellLines, empty: buyLines.length === 0 && sellLines.length === 0 };
  }

  function renderCart() {
    const el = document.getElementById('shop-cart');
    const s = cartSummary();
    if (s.empty) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.classList.add('show');

    const cartKorel = (data.korel ?? 0) + s.net;
    const cantAfford = cartKorel < 0;
    const totalClass = cantAfford ? 'neg' : (s.net > 0 ? 'pos' : 'neutral');

    const lineHtml = (line, side, sign) => `
      <div class="cart-line">
        <span class="cart-line-name">${esc(line.name)}</span>
        <span class="cart-line-qty">×${line.qty}</span>
        <span class="cart-line-sub">${sign}${line.subtotal} korel</span>
        <button class="cart-remove" onclick="Views.shop.setCartQty('${side}', '${line.id}', 0)" title="Remove">×</button>
      </div>`;

    el.innerHTML = `
      <div class="cart-head">
        <span class="cart-net ${totalClass}">Total: ${s.net >= 0 ? '+' : ''}${s.net} korel</span>
        <button class="cart-clear" onclick="Views.shop.clearCart()">Clear</button>
        <button class="cart-checkout" onclick="Views.shop.checkout()" ${cantAfford ? 'disabled' : ''}>Checkout</button>
      </div>
      <div class="cart-lines">
        ${s.buyLines.map(l => lineHtml(l, 'buys', '−')).join('')}
        ${s.sellLines.map(l => lineHtml(l, 'sells', '+')).join('')}
      </div>
    `;
  }

  function clearCart() {
    cart = { buys: {}, sells: {} };
    renderBuy(); renderSell(); renderCart();
  }

  async function checkout() {
    const buys  = Object.entries(cart.buys).map(([itemId, quantity]) => ({ itemId, quantity }));
    const sells = Object.entries(cart.sells).map(([itemId, quantity]) => ({ itemId, quantity }));
    if (buys.length === 0 && sells.length === 0) return;
    const res = await fetch(`/api/shop/${shopKey}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buys, sells }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) {
      clearCart();
      await mountLayout();
    }
  }

  function toast(msg, ok) {
    const el = document.getElementById('shop-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    data = null; cart = { buys: {}, sells: {} }; rootEl = null;
  }

  window.Views = window.Views ?? {};
  window.Views.shop = { mount, unmount, adjCart, setCartQty, clearCart, checkout };
  window.showToast = (msg) => toast(msg, true);
})();
