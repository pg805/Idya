let data        = null;
let activeFilter = 'all';
let openRecipe   = null;

// ---- Auth (reuse same token as shop) ----

function getToken() { return localStorage.getItem('shop_auth') ?? ''; }

function authHeaders(json = false) {
  const h = { 'Authorization': `Bearer ${getToken()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

(function initAuth() {
  const auth = new URLSearchParams(location.search).get('auth');
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
  const res = await fetch('/api/craft', { headers: authHeaders() });
  if (res.status === 401) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('auth-error').style.display = 'flex';
    return;
  }
  data = await res.json();
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  render();
}

// ---- Render ----

function render() {
  document.getElementById('char-name').textContent = data.characterName;
  renderProfessions();
  renderRecipes();
}

function renderProfessions() {
  const container = document.getElementById('professions');
  container.innerHTML = '';
  for (const [key, prof] of Object.entries(data.professions)) {
    const pct = prof.level / prof.maxLevel * 100;
    const atMax = prof.level >= prof.maxLevel;
    const nextCost = !atMax ? prof.costs[prof.level].toLocaleString() : null;
    const card = document.createElement('div');
    card.className = 'prof-card';
    card.innerHTML = `
      <p class="prof-name">${esc(prof.label)}</p>
      <p class="prof-level">${prof.level}<span> / ${prof.maxLevel}</span></p>
      <div class="prof-bar-bg"><div class="prof-bar" style="width:${pct}%"></div></div>
      <p class="prof-meta">${atMax ? 'Mastered' : `Next level: ${nextCost} korel`}</p>
    `;
    container.appendChild(card);
  }
}

function renderRecipes() {
  const list = document.getElementById('recipe-list');
  const visible = data.recipes.filter(r => activeFilter === 'all' || r.profession === activeFilter);

  if (visible.length === 0) {
    list.innerHTML = '<p class="empty">No recipes here yet.</p>';
    return;
  }

  list.innerHTML = '';
  for (const r of visible) {
    const isOpen = openRecipe === r.id;
    const badge  = r.available        ? `<span class="recipe-badge badge-available">Ready</span>`
                 : !r.levelMet        ? `<span class="recipe-badge badge-locked">Lvl ${r.required_level} ${profLabel(r.profession)}</span>`
                 :                      `<span class="recipe-badge badge-materials">Need materials</span>`;

    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.innerHTML = `
      <div class="recipe-row${isOpen ? ' open' : ''}" onclick="toggleRecipe('${r.id}')">
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
                    <span>${esc(i.item_id)}</span>
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
          <button class="craft-btn" onclick="doCraft('${r.id}')" ${r.available ? '' : 'disabled'}>Craft</button>
        </div>` : ''}
    `;
    list.appendChild(card);
  }
}

function profLabel(key) {
  return { lumberjack: 'LJ', blacksmith: 'BS', enchanter: 'EN' }[key] ?? key;
}

function toggleRecipe(id) {
  openRecipe = openRecipe === id ? null : id;
  renderRecipes();
}

function filterRecipes(prof) {
  activeFilter = prof;
  openRecipe   = null;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.prof === prof);
  });
  renderRecipes();
}

// ---- Craft ----

async function doCraft(recipeId) {
  const res = await fetch(`/api/craft/${recipeId}`, {
    method: 'POST', headers: authHeaders(true),
    body: JSON.stringify({}),
  });
  const r = await res.json();
  toast(r.message ?? r.error, r.success !== false);
  if (r.success) {
    openRecipe = null;
    const fresh = await fetch('/api/craft', { headers: authHeaders() });
    if (fresh.ok) { data = await fresh.json(); render(); }
  }
}

// ---- Toast ----

function toast(msg, ok) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${ok ? 'ok' : 'err'}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 4500);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

load();
