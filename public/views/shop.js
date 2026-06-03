// View: Shop — cart-based buy/sell.
(function() {
  let shopKey  = null;
  let data     = null;
  let cart     = { buys: {}, sells: {}, buyWeapons: {}, weapons: new Set() };  // buyWeapons: {weaponKey: qty}, weapons: Set of instance IDs
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

  function getBuyWeaponQty(weaponKey) { return cart.buyWeapons[weaponKey] ?? 0; }
  function adjBuyWeapon(weaponKey, delta, max) {
    const cur = getBuyWeaponQty(weaponKey);
    const next = Math.max(0, Math.min(max, cur + delta));
    if (next <= 0) delete cart.buyWeapons[weaponKey];
    else cart.buyWeapons[weaponKey] = next;
    renderBuy(); renderCart();
  }

  async function mount(root, params) {
    rootEl  = root;
    shopKey = params.shopKey;
    cart    = { buys: {}, sells: {}, buyWeapons: {}, weapons: new Set() };
    setLayoutTitle('Shop');
    root.innerHTML = `
      <div id="shop-subhead">
        <div id="shop-subhead-inner">
          <p id="shop-name-line"></p>
          <p id="shop-greeting"></p>
        </div>
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
      <div id="shop-cart"></div>
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
    const weaponListings = (data.weapon_listings ?? []).filter(w => w.buy != null);
    const list = document.getElementById('shop-buy-list');

    if (forSale.length === 0 && weaponListings.length === 0) {
      list.innerHTML = '<p class="shop-empty">Nothing for sale right now.</p>';
      return;
    }
    list.innerHTML = '';

    for (const item of forSale) {
      const oos       = !item.infinite && item.stock === 0;
      const stockText = item.infinite ? 'Always in stock' : `${item.stock}/${item.stock_max} in stock`;
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

    if (weaponListings.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'shop-divider';
      divider.textContent = 'Weapons';
      list.appendChild(divider);

      for (const w of weaponListings) {
        const oos       = !w.infinite && w.stock === 0;
        const stockText = w.infinite ? 'Always in stock' : `${w.stock}/${w.stock_max} in stock`;
        const maxQty    = w.infinite ? 99 : Math.min(99, w.stock);
        const qty       = getBuyWeaponQty(w.weapon_key);
        const el = document.createElement('div');
        el.className = 'shop-item';
        el.innerHTML = `
          <div class="shop-item-row">
            <div class="shop-item-info">
              <span class="shop-item-name${oos ? ' dim' : ''}">${esc(w.name)}</span>
              <span class="shop-item-sub">${oos ? 'out of stock' : `${w.buy} korel · ${stockText}`}</span>
            </div>
            ${oos ? '' : `
              <div class="shop-cart-ctrl">
                <button class="shop-step" onclick="Views.shop.adjBuyWeapon('${w.weapon_key}', -1, ${maxQty})" ${qty <= 0 ? 'disabled' : ''}>−</button>
                <span class="shop-step-val">${qty}</span>
                <button class="shop-step" onclick="Views.shop.adjBuyWeapon('${w.weapon_key}', 1, ${maxQty})" ${qty >= maxQty ? 'disabled' : ''}>+</button>
              </div>`}
          </div>
        `;
        list.appendChild(el);
      }
    }
  }

  function renderSell() {
    const sellable = data.inventory.filter(inv => {
      const si = data.items.find(i => i.id === inv.item_id);
      return si && si.sell != null;
    });
    const sellableWeapons = (data.weapons ?? []).filter(w => w.sell != null);

    const list = document.getElementById('shop-sell-list');
    if (sellable.length === 0 && sellableWeapons.length === 0) {
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
        ? `shop is fully stocked · own ${inv.quantity}`
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

    if (sellableWeapons.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'shop-divider';
      divider.textContent = 'Weapons';
      list.appendChild(divider);

      for (const w of sellableWeapons) {
        const inCart = cart.weapons.has(w.id);
        const subPart = w.equipped ? 'equipped — unequip to sell' : `${w.sell} korel`;
        const bonusTag = w.bonus_count > 0 ? ` <span class="shop-w-bonus">+${w.bonus_count}</span>` : '';
        const el = document.createElement('div');
        el.className = 'shop-item' + (w.equipped ? ' shop-equipped' : '');
        el.innerHTML = `
          <div class="shop-item-row">
            <div class="shop-item-info">
              <span class="shop-item-name">${esc(w.name)}${bonusTag}</span>
              <span class="shop-item-sub">${esc(subPart)}</span>
            </div>
            ${w.equipped ? '' : `
              <div class="shop-cart-ctrl">
                <button class="shop-step" onclick="Views.shop.toggleWeapon('${w.id}')" ${inCart ? '' : 'disabled'}>−</button>
                <span class="shop-step-val">${inCart ? 1 : 0}</span>
                <button class="shop-step" onclick="Views.shop.toggleWeapon('${w.id}')" ${inCart ? 'disabled' : ''}>+</button>
              </div>`}
          </div>
        `;
        list.appendChild(el);
      }
    }
  }

  function toggleWeapon(id) {
    if (cart.weapons.has(id)) cart.weapons.delete(id);
    else cart.weapons.add(id);
    renderSell();
    renderCart();
  }

  function cartSummary() {
    let cost = 0, revenue = 0;
    const buyLines       = [];
    const sellLines      = [];
    const buyWeaponLines = [];
    const sellWeaponLines = [];
    for (const [id, qty] of Object.entries(cart.buys)) {
      const item = data.items.find(i => i.id === id);
      if (!item) continue;
      const sub = item.buy * qty;
      cost += sub;
      buyLines.push({ id, name: item.name, qty, subtotal: sub, unit: item.buy });
    }
    for (const [key, qty] of Object.entries(cart.buyWeapons)) {
      const w = (data.weapon_listings ?? []).find(x => x.weapon_key === key);
      if (!w) continue;
      const sub = w.buy * qty;
      cost += sub;
      buyWeaponLines.push({ key, name: w.name, qty, subtotal: sub });
    }
    for (const [id, qty] of Object.entries(cart.sells)) {
      const item = data.items.find(i => i.id === id);
      if (!item) continue;
      const sub = item.sell * qty;
      revenue += sub;
      sellLines.push({ id, name: item.name, qty, subtotal: sub, unit: item.sell });
    }
    for (const wid of cart.weapons) {
      const w = (data.weapons ?? []).find(x => x.id === wid);
      if (!w || w.sell == null) continue;
      revenue += w.sell;
      sellWeaponLines.push({ id: w.id, name: w.name, bonus_count: w.bonus_count, subtotal: w.sell });
    }
    return {
      cost, revenue, net: revenue - cost,
      buyLines, sellLines, buyWeaponLines, sellWeaponLines,
      empty: buyLines.length === 0 && sellLines.length === 0 && buyWeaponLines.length === 0 && sellWeaponLines.length === 0,
    };
  }

  function renderCart() {
    const el = document.getElementById('shop-cart');
    const s = cartSummary();
    if (s.empty) {
      el.innerHTML = '';
      el.classList.remove('show');
      document.body.classList.remove('cart-open');
      return;
    }
    el.classList.add('show');
    document.body.classList.add('cart-open');

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

    const sellWeaponLineHtml = (line) => `
      <div class="cart-line">
        <span class="cart-line-name">${esc(line.name)}${line.bonus_count > 0 ? ` <span class="shop-w-bonus">+${line.bonus_count}</span>` : ''}</span>
        <span class="cart-line-qty">weapon</span>
        <span class="cart-line-sub">+${line.subtotal} korel</span>
        <button class="cart-remove" onclick="Views.shop.toggleWeapon('${line.id}')" title="Remove">×</button>
      </div>`;

    const buyWeaponLineHtml = (line) => `
      <div class="cart-line">
        <span class="cart-line-name">${esc(line.name)} <span class="shop-w-bonus">weapon</span></span>
        <span class="cart-line-qty">×${line.qty}</span>
        <span class="cart-line-sub">−${line.subtotal} korel</span>
        <button class="cart-remove" onclick="Views.shop.adjBuyWeapon('${line.key}', -${line.qty}, 0)" title="Remove">×</button>
      </div>`;

    el.innerHTML = `
      <div class="cart-head">
        <span class="cart-net ${totalClass}">Total: ${s.net >= 0 ? '+' : ''}${s.net} korel</span>
        <button class="cart-clear" onclick="Views.shop.clearCart()">Clear</button>
        <button class="cart-checkout" onclick="Views.shop.checkout()" ${cantAfford ? 'disabled' : ''}>Checkout</button>
      </div>
      <div class="cart-lines">
        ${s.buyLines.map(l => lineHtml(l, 'buys', '−')).join('')}
        ${s.buyWeaponLines.map(buyWeaponLineHtml).join('')}
        ${s.sellLines.map(l => lineHtml(l, 'sells', '+')).join('')}
        ${s.sellWeaponLines.map(sellWeaponLineHtml).join('')}
      </div>
    `;

    requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--cart-h', `${el.offsetHeight}px`);
    });
  }

  function clearCart() {
    cart = { buys: {}, sells: {}, buyWeapons: {}, weapons: new Set() };
    renderBuy(); renderSell(); renderCart();
  }

  async function checkout() {
    const buys        = Object.entries(cart.buys).map(([itemId, quantity]) => ({ itemId, quantity }));
    const sells       = Object.entries(cart.sells).map(([itemId, quantity]) => ({ itemId, quantity }));
    const buyWeapons  = Object.entries(cart.buyWeapons).map(([weaponKey, quantity]) => ({ weaponKey, quantity }));
    const sellWeapons = Array.from(cart.weapons);
    if (buys.length === 0 && sells.length === 0 && buyWeapons.length === 0 && sellWeapons.length === 0) return;

    if (sellWeapons.length > 0) {
      const ok = await confirmModal(sellWeapons);
      if (!ok) return;
    }

    const res = await fetch(`/api/shop/${shopKey}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buys, sells, buyWeapons, sellWeapons }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) {
      clearCart();
      await mountLayout();
    }
  }

  function confirmModal(weaponIds) {
    return new Promise((resolve) => {
      const lines = weaponIds.map(id => {
        const w = (data.weapons ?? []).find(x => x.id === id);
        if (!w) return '';
        const bonus = w.bonus_count > 0 ? ` +${w.bonus_count}` : '';
        return `<li>${esc(w.name)}${bonus} — ${w.sell} korel</li>`;
      }).join('');
      const overlay = document.createElement('div');
      overlay.className = 'shop-modal-overlay';
      overlay.innerHTML = `
        <div class="shop-modal">
          <h3>Sell ${weaponIds.length} weapon${weaponIds.length > 1 ? 's' : ''}?</h3>
          <p class="shop-modal-warn">This is permanent — the weapon${weaponIds.length > 1 ? 's' : ''} and all upgrades/enchants are lost.</p>
          <ul class="shop-modal-list">${lines}</ul>
          <div class="shop-modal-actions">
            <button class="cart-clear" data-action="cancel">Cancel</button>
            <button class="cart-checkout" data-action="confirm">Sell</button>
          </div>
        </div>
      `;
      overlay.addEventListener('click', (e) => {
        const t = e.target;
        if (t === overlay) { overlay.remove(); resolve(false); return; }
        const action = t?.dataset?.action;
        if (action === 'cancel')  { overlay.remove(); resolve(false); }
        if (action === 'confirm') { overlay.remove(); resolve(true); }
      });
      document.body.appendChild(overlay);
    });
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
    document.body.classList.remove('cart-open');
    data = null; cart = { buys: {}, sells: {}, buyWeapons: {}, weapons: new Set() }; rootEl = null;
  }

  window.Views = window.Views ?? {};
  window.Views.shop = { mount, unmount, adjCart, setCartQty, adjBuyWeapon, toggleWeapon, clearCart, checkout };
  window.showToast = (msg) => toast(msg, true);
})();
