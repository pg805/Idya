// View: Create Character — name + bio + nationality + sprite grid.
(function() {
  let sprites = [];      // [{ key, name }]
  let spriteCdn = '';
  let selectedKey = null;
  let spriteFilter = '';
  let submitting = false;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function mount(root) {
    setLayoutTitle('Register');

    // If the user already has a character, bounce them to /character.
    try {
      const r = await fetch('/api/character');
      if (r.ok) {
        navigate('/character');
        return;
      }
    } catch (_) {}

    root.innerHTML = `
      <div id="create-body">
        <header class="create-header">
          <h1 class="create-title">Census Log</h1>
          <p class="create-sub">Register your character to begin. You'll get a tutorial battle once you're done.</p>
        </header>

        <section class="create-card">
          <label class="create-label" for="create-name">Name</label>
          <input id="create-name" type="text" maxlength="32" placeholder="Your character's name" autocomplete="off">

          <label class="create-label" for="create-bio">About <span class="create-label-meta">(optional)</span></label>
          <textarea id="create-bio" maxlength="300" rows="3" placeholder="Anything else you want others to know"></textarea>

          <label class="create-label">Nationality</label>
          <div class="create-nationality">
            <button type="button" class="create-nat-btn" data-nat="Chae">
              <span class="create-nat-name">Chae</span>
              <span class="create-nat-meta">Empire citizen</span>
            </button>
            <button type="button" class="create-nat-btn" data-nat="Ketulvu">
              <span class="create-nat-name">Ketulvu</span>
              <span class="create-nat-meta">Frontier local</span>
            </button>
          </div>

          <label class="create-label">Sprite <span id="create-sprite-chosen" class="create-label-meta"></span></label>
          <input id="create-sprite-filter" type="text" placeholder="Filter sprites…" autocomplete="off">
          <div id="create-sprite-grid" class="create-sprite-grid"></div>
        </section>

        <footer class="create-footer">
          <button id="create-submit" class="create-submit" disabled>Begin Tutorial</button>
          <p id="create-error" class="create-error" hidden></p>
        </footer>
      </div>
    `;

    const res = await fetch('/api/sprites');
    if (res.ok) {
      const data = await res.json();
      sprites   = data.sprites ?? [];
      spriteCdn = data.spriteCdn ?? '';
    }

    document.getElementById('create-name').addEventListener('input', updateSubmit);
    document.getElementById('create-bio').addEventListener('input', updateSubmit);
    document.querySelectorAll('.create-nat-btn').forEach(btn => {
      btn.addEventListener('click', () => selectNationality(btn.dataset.nat));
    });
    document.getElementById('create-sprite-filter').addEventListener('input', (e) => {
      spriteFilter = e.target.value.toLowerCase();
      renderSpriteGrid();
    });
    document.getElementById('create-submit').addEventListener('click', submit);

    renderSpriteGrid();
    updateSubmit();
  }

  function selectNationality(nat) {
    document.querySelectorAll('.create-nat-btn').forEach(b => b.classList.toggle('selected', b.dataset.nat === nat));
    updateSubmit();
  }

  function getNationality() {
    const sel = document.querySelector('.create-nat-btn.selected');
    return sel?.dataset.nat ?? null;
  }

  function renderSpriteGrid() {
    const grid = document.getElementById('create-sprite-grid');
    const chosen = document.getElementById('create-sprite-chosen');
    const filtered = sprites.filter(s => s.name.toLowerCase().includes(spriteFilter) || s.key.toLowerCase().includes(spriteFilter));
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="create-sprite-empty">No sprites match.</p>';
    } else {
      grid.innerHTML = filtered.map(s => `
        <button type="button" class="create-sprite${s.key === selectedKey ? ' selected' : ''}" data-key="${esc(s.key)}">
          <img src="${esc(spriteCdn)}/${esc(s.key)}.png" alt="${esc(s.name)}" loading="lazy" onerror="this.style.visibility='hidden'">
          <span class="create-sprite-name">${esc(s.name)}</span>
        </button>
      `).join('');
      grid.querySelectorAll('.create-sprite').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedKey = btn.dataset.key;
          renderSpriteGrid();
          updateSubmit();
        });
      });
    }
    const selected = sprites.find(s => s.key === selectedKey);
    chosen.textContent = selected ? `— ${selected.name}` : '';
  }

  function updateSubmit() {
    const name = document.getElementById('create-name')?.value.trim() ?? '';
    const ok = name.length > 0 && getNationality() && selectedKey;
    document.getElementById('create-submit').disabled = !ok || submitting;
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    const err = document.getElementById('create-error');
    err.hidden = true;
    document.getElementById('create-submit').disabled = true;
    document.getElementById('create-submit').textContent = 'Creating…';
    try {
      const res = await fetch('/api/character/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        document.getElementById('create-name').value.trim(),
          bio:         document.getElementById('create-bio').value.trim() || undefined,
          nationality: getNationality(),
          sprite_key:  selectedKey,
        }),
      });
      const r = await res.json().catch(() => ({}));
      if (!r.success) throw new Error(r.message ?? r.error ?? 'Could not create character.');
      // Refresh the header so the new character + sprite show up, then head
      // straight into the tutorial battle.
      if (typeof mountLayout === 'function') await mountLayout().catch(() => {});
      location.href = r.session_url;
    } catch (e) {
      submitting = false;
      document.getElementById('create-submit').disabled = false;
      document.getElementById('create-submit').textContent = 'Begin Tutorial';
      err.textContent = e.message;
      err.hidden = false;
    }
  }

  function unmount() {
    sprites = []; spriteCdn = ''; selectedKey = null; spriteFilter = ''; submitting = false;
  }

  window.Views = window.Views ?? {};
  window.Views.create = { mount, unmount };
})();
