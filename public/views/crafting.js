// View: Crafting — recipe browser & craft action.
(function() {
  let data        = null;
  let activeProfs = null;
  let openRecipe  = null;

  const PROF_LABEL = { lumberjack: 'Lumberjack', blacksmith: 'Blacksmith', enchanter: 'Enchanter' };

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function profLabel(key) {
    return { lumberjack: 'LJ', blacksmith: 'BS', enchanter: 'EN' }[key] ?? key;
  }

  async function mount(root) {
    setLayoutTitle('Crafting');
    root.innerHTML = `
      <section id="craft-tab">
        <div id="recipe-filter"></div>
        <div id="recipe-list"></div>
      </section>
      <div id="craft-toast"></div>
    `;
    window.addEventListener('layout-changed', layoutChangedHandler);
    await refreshAll();
  }

  function layoutChangedHandler() { if (data) refreshAll(); }

  async function refreshAll() {
    const res = await fetch('/api/craft');
    if (!res.ok) return;
    data = await res.json();
    initProfFilter();
    renderRecipeFilter();
    renderRecipes();
  }

  function initProfFilter() {
    if (activeProfs !== null) return;
    const owned = Object.entries(data.professions ?? {})
      .filter(([, p]) => (p?.level ?? 0) > 0)
      .map(([key]) => key);
    activeProfs = new Set(owned.length > 0 ? owned : Object.keys(PROF_LABEL));
  }

  function renderRecipeFilter() {
    const el = document.getElementById('recipe-filter');
    el.innerHTML = Object.keys(PROF_LABEL).map(key => `
      <label class="filter-check">
        <input type="checkbox" ${activeProfs.has(key) ? 'checked' : ''} onchange="Views.crafting.toggleProf('${key}')">
        ${PROF_LABEL[key]}
      </label>
    `).join('');
  }

  function toggleProf(key) {
    if (activeProfs.has(key)) activeProfs.delete(key);
    else activeProfs.add(key);
    openRecipe = null;
    renderRecipes();
  }

  function renderRecipes() {
    const list = document.getElementById('recipe-list');
    const visible = data.recipes.filter(r =>
      r.output?.type !== 'enchant' && activeProfs.has(r.profession)
    );

    if (visible.length === 0) {
      list.innerHTML = '<p class="empty">No recipes here yet.</p>';
      return;
    }

    list.innerHTML = '';
    for (const r of visible) {
      const isOpen = openRecipe === r.id;
      const badge  = r.available  ? `<span class="recipe-badge badge-available">Ready</span>`
                   : !r.levelMet  ? `<span class="recipe-badge badge-locked">Lvl ${r.required_level} ${profLabel(r.profession)}</span>`
                   :                `<span class="recipe-badge badge-materials">Need materials</span>`;

      const card = document.createElement('div');
      card.className = 'recipe-card';
      card.innerHTML = `
        <div class="recipe-row${isOpen ? ' open' : ''}" onclick="Views.crafting.toggleRecipe('${r.id}')">
          <span class="recipe-name${!r.levelMet ? ' dim' : ''}">${esc(r.name)}</span>
          ${badge}
        </div>
        ${isOpen ? `
          <div class="recipe-detail">
            ${r.description ? `<p class="recipe-desc">${esc(r.description)}</p>` : ''}
            <div class="recipe-meta">
              <div>
                <p class="meta-label">Ingredients</p>
                <div class="ingredient-list">
                  ${r.ingredients.map(i => {
                    const have = data.inventory[i.item_id] ?? 0;
                    const ok   = have >= i.quantity;
                    return `<span class="ingredient">
                      <span>${esc(i.name)}</span>
                      <span class="${ok ? 'have' : 'missing'}">${have} / ${i.quantity}</span>
                    </span>`;
                  }).join('')}
                </div>
              </div>
              <div>
                <p class="meta-label">Output</p>
                <div class="output-line">
                  <span>${esc(r.name)}</span>
                  ${r.output.quantity && r.output.quantity > 1 ? `<span style="color:#445">×${r.output.quantity}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="craft-row">
              <div class="craft-qty-ctrl${r.available ? '' : ' disabled'}">
                <button class="craft-step" onclick="Views.crafting.adjCraftQty('${r.id}', -1)" ${r.available ? '' : 'disabled'}>−</button>
                <input class="craft-qty" id="qty-${r.id}" type="text" inputmode="numeric" pattern="[0-9]*"
                  autocomplete="off" maxlength="3"
                  value="1" data-max="${maxCraftable(r)}"
                  oninput="Views.crafting.onQtyInput('${r.id}')"
                  ${r.available ? '' : 'disabled'}>
                <button class="craft-step" onclick="Views.crafting.adjCraftQty('${r.id}', 1)" ${r.available ? '' : 'disabled'}>+</button>
                <button class="craft-all" onclick="Views.crafting.setCraftQty('${r.id}', ${maxCraftable(r)})" ${r.available ? '' : 'disabled'}>ALL</button>
              </div>
              <button class="craft-btn" onclick="Views.crafting.doCraft('${r.id}')" ${r.available ? '' : 'disabled'}>Craft</button>
            </div>
          </div>` : ''}
      `;
      list.appendChild(card);
    }
  }

  function toggleRecipe(id) {
    openRecipe = openRecipe === id ? null : id;
    renderRecipes();
  }

  // Max craftable based on current inventory — limited by the scarcest
  // ingredient. Capped at 99 to match the server-side batch cap.
  function maxCraftable(recipe) {
    if (!recipe.available) return 0;
    if (!recipe.ingredients || recipe.ingredients.length === 0) return 99;
    const maxByIng = recipe.ingredients.map(i => {
      const have = data.inventory[i.item_id] ?? 0;
      return Math.floor(have / i.quantity);
    });
    return Math.max(0, Math.min(99, ...maxByIng));
  }

  function setCraftQty(recipeId, qty) {
    const input = document.getElementById(`qty-${recipeId}`);
    if (!input) return;
    const max = parseInt(input.dataset.max, 10) || 1;
    const clamped = Math.max(1, Math.min(max, Math.floor(qty)));
    input.value = String(clamped);
  }

  function adjCraftQty(recipeId, delta) {
    const input = document.getElementById(`qty-${recipeId}`);
    if (!input) return;
    const cur = parseInt(input.value, 10) || 1;
    setCraftQty(recipeId, cur + delta);
  }

  // Input handler: strip non-digits, clamp to max in-place (preserves cursor).
  function onQtyInput(recipeId) {
    const input = document.getElementById(`qty-${recipeId}`);
    if (!input) return;
    const cleaned = input.value.replace(/\D/g, '');
    const max = parseInt(input.dataset.max, 10) || 1;
    const clamped = Math.max(0, Math.min(max, parseInt(cleaned, 10) || 0));
    if (String(clamped) !== input.value) input.value = String(clamped);
  }

  async function doCraft(recipeId) {
    const quantity = parseInt(document.getElementById(`qty-${recipeId}`)?.value ?? '1', 10) || 1;
    const res = await fetch(`/api/craft/${recipeId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    });
    const r = await res.json();
    toast(r.message ?? r.error, r.success !== false);
    if (r.success) {
      openRecipe = null;
      await mountLayout();
    }
  }

  function toast(msg, ok) {
    const el = document.getElementById('craft-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `show ${ok ? 'ok' : 'err'}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 4500);
  }

  function unmount() {
    window.removeEventListener('layout-changed', layoutChangedHandler);
    data = null; activeProfs = null; openRecipe = null;
  }

  window.Views = window.Views ?? {};
  window.Views.crafting = { mount, unmount, toggleProf, toggleRecipe, doCraft, adjCraftQty, setCraftQty, onQtyInput };
  window.showToast = (msg) => toast(msg, true);
})();
