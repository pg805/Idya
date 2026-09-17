// View: Create Character.
//
// Two things are required: a name and a sprite. Everything else on this page is
// optional and can be filled in later, and what it buys is canon status rather
// than access (docs/world.md section 11). A provisional character plays the game
// identically to an approved one, so the door is never a bottleneck.
//
// The catalogue (forces, stances, goals, names) is fetched from
// /api/character/options rather than duplicated here, so this screen cannot
// disagree with the server about what exists.
(function() {
  let opts = null;               // the whole catalogue
  let sprites = [];
  let spriteCdn = '';
  let selectedKey = null;
  let spriteFilter = '';
  let submitting = false;

  // goal kind key -> { variant, detail }
  const goals = new Map();
  // force key -> stance key
  const stances = new Map();

  const MAX_GOALS = 3;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function mount(root) {
    setLayoutTitle('Register');

    try {
      const r = await fetch('/api/character');
      if (r.ok) { navigate('/character'); return; }
    } catch (_) {}

    const res = await fetch('/api/character/options');
    opts = res.ok ? await res.json() : null;
    if (!opts) {
      root.innerHTML = '<div class="splash"><p>Could not load character options. Reload the page.</p></div>';
      return;
    }
    sprites   = opts.sprites ?? [];
    spriteCdn = opts.spriteCdn ?? '';

    root.innerHTML = `
      <div id="create-body">
        <header class="create-header">
          <h1 class="create-title">Census Log</h1>
          <p class="create-sub">A name and a face are all you need to start. Everything below that is optional, and you can come back to it whenever you like.</p>
        </header>

        <section class="create-card">
          <p class="create-section-head">Required</p>

          <label class="create-label" for="create-name">Name</label>
          <input id="create-name" type="text" maxlength="32" placeholder="Your character's name" autocomplete="off">
          <div class="create-namepick">
            <button type="button" class="create-link" id="create-name-toggle">Pick one from the register</button>
            <div id="create-name-lists" hidden></div>
          </div>

          <label class="create-label">Face <span id="create-sprite-chosen" class="create-label-meta"></span></label>
          <input id="create-sprite-filter" type="text" placeholder="Filter faces..." autocomplete="off">
          <div id="create-sprite-grid" class="create-sprite-grid"></div>
        </section>

        <section class="create-card create-optional">
          <p class="create-section-head">The rest of the sheet</p>
          <p class="create-note">
            None of this is required to play, and leaving it blank costs you nothing you can see:
            a provisional character fights, crafts and trades exactly like any other.
            What a filled-in sheet earns is <strong>canon</strong>. The GM reads it, and an approved
            character starts the world already meaning something to somebody, with hooks and quests
            attached. A thin one starts at zero and earns it in play.
          </p>

          <label class="create-label">Where you are from <span class="create-label-meta">(optional)</span></label>
          <div class="create-nationality">
            <button type="button" class="create-nat-btn" data-nat="Chae">
              <span class="create-nat-name">Chae</span>
              <span class="create-nat-meta">Of Chaevul descent</span>
            </button>
            <button type="button" class="create-nat-btn" data-nat="Ketulvu">
              <span class="create-nat-name">Ketulvu</span>
              <span class="create-nat-meta">Of the people the Chaevul lead</span>
            </button>
          </div>

          <label class="create-label" for="create-physical">What you look like <span class="create-label-meta">(optional)</span></label>
          <textarea id="create-physical" maxlength="1000" rows="3" placeholder="Height, build, how you carry yourself, what you wear. What someone notices first."></textarea>

          <label class="create-label" for="create-bio">About <span class="create-label-meta">(optional)</span></label>
          <textarea id="create-bio" maxlength="1500" rows="8" placeholder="Who you were before the caravan. What you left. What you are like to be around."></textarea>

          <label class="create-label" for="create-relationships">Who you know <span class="create-label-meta">(optional)</span></label>
          <textarea id="create-relationships" maxlength="1500" rows="4" placeholder="Family, debts, rivals, anyone back home who would come looking. They do not have to be other players."></textarea>
        </section>

        <section class="create-card create-optional">
          <p class="create-section-head">What you are here to do</p>
          <p class="create-note">
            A goal is not backstory. Each one is something the world can actually track, and
            when you finish it you pick another. Choose up to ${MAX_GOALS}.
          </p>
          <div id="create-goals" class="create-goals"></div>
        </section>

        <section class="create-card create-optional">
          <p class="create-section-head">The forces at play</p>
          <p class="create-note">
            Five of them want this mine, for five different reasons. You do not have to care about
            any of them, and saying so is an answer. Hiding from one is worth as much to the story
            as backing it.
          </p>
          <div id="create-forces" class="create-forces"></div>
        </section>

        <footer class="create-footer">
          <button id="create-submit" class="create-submit" disabled>Begin</button>
          <p class="create-note create-footer-note">You can edit any of this later. Your sheet stays a draft until you submit it and the GM approves it.</p>
          <p id="create-error" class="create-error" hidden></p>
        </footer>
      </div>
    `;

    renderNameLists();
    renderGoals();
    renderForces();
    renderSpriteGrid();

    document.getElementById('create-name').addEventListener('input', updateSubmit);
    document.getElementById('create-name-toggle').addEventListener('click', () => {
      const el = document.getElementById('create-name-lists');
      el.hidden = !el.hidden;
      document.getElementById('create-name-toggle').textContent =
        el.hidden ? 'Pick one from the register' : 'Hide the register';
    });
    document.querySelectorAll('.create-nat-btn').forEach(btn => {
      btn.addEventListener('click', () => selectNationality(btn.dataset.nat));
    });
    document.getElementById('create-sprite-filter').addEventListener('input', (e) => {
      spriteFilter = e.target.value.toLowerCase();
      renderSpriteGrid();
    });
    document.getElementById('create-submit').addEventListener('click', submit);

    updateSubmit();
  }

  // ---- name register ----

  function renderNameLists() {
    const host = document.getElementById('create-name-lists');
    const names = opts.names ?? {};
    host.innerHTML = Object.entries(names).map(([culture, list]) => `
      <div class="create-name-group">
        <p class="create-name-culture">${esc(culture)}</p>
        <div class="create-name-chips">
          ${list.map(n => `<button type="button" class="create-name-chip" data-name="${esc(n)}">${esc(n)}</button>`).join('')}
        </div>
      </div>
    `).join('');
    host.querySelectorAll('.create-name-chip').forEach(b => {
      b.addEventListener('click', () => {
        document.getElementById('create-name').value = b.dataset.name;
        updateSubmit();
      });
    });
  }

  // ---- goals ----

  function renderGoals() {
    const host = document.getElementById('create-goals');
    host.innerHTML = (opts.goals ?? []).map(g => {
      const chosen = goals.has(g.key);
      const state = goals.get(g.key) ?? {};
      const isOwnPath = g.variants.length === 0;
      return `
        <div class="create-goal${chosen ? ' selected' : ''}" data-kind="${esc(g.key)}">
          <button type="button" class="create-goal-head" data-kind="${esc(g.key)}">
            <span class="create-goal-mark">${chosen ? '&#10003;' : ''}</span>
            <span class="create-goal-text">
              <span class="create-goal-label">${esc(g.label)}</span>
              <span class="create-goal-blurb">${esc(g.blurb)}</span>
            </span>
          </button>
          ${chosen ? `
            <div class="create-goal-body">
              ${g.variantLabel ? `<p class="create-goal-varlabel">${esc(g.variantLabel)}</p>` : ''}
              ${g.variants.map(v => `
                <button type="button" class="create-goal-variant${state.variant === v.key ? ' selected' : ''}"
                        data-kind="${esc(g.key)}" data-variant="${esc(v.key)}">
                  <span class="create-goal-vlabel">${esc(v.label)}</span>
                  <span class="create-goal-vblurb">${esc(v.blurb)}</span>
                </button>
              `).join('')}
              ${isOwnPath ? `
                <p class="create-goal-proposal">
                  This one is a <strong>proposal</strong>, not a goal yet. The world can only track
                  things it has been taught to track, so what you write here goes to the GM the same
                  way any other application does. If it is good it gets built, and then it becomes a
                  goal anyone can choose.
                </p>
              ` : ''}
              <textarea class="create-goal-detail" data-kind="${esc(g.key)}" maxlength="1000" rows="${isOwnPath ? 5 : 2}"
                placeholder="${isOwnPath
                  ? 'What is your character here to do, and what would it take for the world to agree you had done it?'
                  : 'In your own words (optional).'}">${esc(state.detail ?? '')}</textarea>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    host.querySelectorAll('.create-goal-head').forEach(b => {
      b.addEventListener('click', () => {
        const k = b.dataset.kind;
        if (goals.has(k)) goals.delete(k);
        else if (goals.size < MAX_GOALS) goals.set(k, { variant: null, detail: '' });
        renderGoals();
      });
    });
    host.querySelectorAll('.create-goal-variant').forEach(b => {
      b.addEventListener('click', () => {
        const st = goals.get(b.dataset.kind);
        if (!st) return;
        // Clicking the chosen one again clears it, so a goal can go back to
        // having no variant rather than being stuck on a first guess.
        st.variant = st.variant === b.dataset.variant ? null : b.dataset.variant;
        renderGoals();
      });
    });
    host.querySelectorAll('.create-goal-detail').forEach(t => {
      t.addEventListener('input', () => {
        const st = goals.get(t.dataset.kind);
        if (st) st.detail = t.value;
      });
    });
  }

  // ---- forces ----

  function renderForces() {
    const host = document.getElementById('create-forces');
    host.innerHTML = (opts.forces ?? []).map(f => `
      <div class="create-force">
        <p class="create-force-name">${esc(f.name)}</p>
        <p class="create-force-want">${esc(f.want)}</p>
        <div class="create-force-stances">
          ${(opts.stances ?? []).map(st => `
            <button type="button" class="create-stance${stances.get(f.key) === st.key ? ' selected' : ''}"
                    data-force="${esc(f.key)}" data-stance="${esc(st.key)}" title="${esc(st.blurb)}">
              ${esc(st.label)}
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');
    host.querySelectorAll('.create-stance').forEach(b => {
      b.addEventListener('click', () => {
        const f = b.dataset.force;
        // Same click twice means "actually, no stance", which is different from
        // indifferent: one is a blank, the other is a statement.
        if (stances.get(f) === b.dataset.stance) stances.delete(f);
        else stances.set(f, b.dataset.stance);
        renderForces();
      });
    });
  }

  // ---- sprite + nationality ----

  function selectNationality(nat) {
    const btn = document.querySelector(`.create-nat-btn[data-nat="${nat}"]`);
    const already = btn?.classList.contains('selected');
    document.querySelectorAll('.create-nat-btn').forEach(b => b.classList.remove('selected'));
    if (!already) btn?.classList.add('selected');
  }

  function getNationality() {
    return document.querySelector('.create-nat-btn.selected')?.dataset.nat ?? null;
  }

  function renderSpriteGrid() {
    const grid = document.getElementById('create-sprite-grid');
    const chosen = document.getElementById('create-sprite-chosen');
    const filtered = sprites.filter(s => s.name.toLowerCase().includes(spriteFilter) || s.key.toLowerCase().includes(spriteFilter));
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="create-sprite-empty">No faces match.</p>';
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
    chosen.textContent = selected ? `- ${selected.name}` : '';
  }

  function updateSubmit() {
    const name = document.getElementById('create-name')?.value.trim() ?? '';
    const ok = name.length > 0 && selectedKey;
    document.getElementById('create-submit').disabled = !ok || submitting;
  }

  // ---- submit ----

  function collectGoals() {
    const out = [];
    for (const [kind, st] of goals) {
      const detail = (st.detail ?? '').trim();
      // A goal kind with variants but none picked is an unfinished thought, and
      // the server would reject it. Drop it rather than fail the whole form.
      const kindDef = (opts.goals ?? []).find(g => g.key === kind);
      const needsVariant = (kindDef?.variants?.length ?? 0) > 0;
      if (needsVariant && !st.variant) continue;
      out.push({ kind, variant: st.variant || null, detail: detail || null });
    }
    return out;
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    const err = document.getElementById('create-error');
    const btn = document.getElementById('create-submit');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Creating...';
    const val = (id) => document.getElementById(id).value.trim() || undefined;
    try {
      const res = await fetch('/api/character/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:          document.getElementById('create-name').value.trim(),
          sprite_key:    selectedKey,
          nationality:   getNationality() ?? undefined,
          physical:      val('create-physical'),
          bio:           val('create-bio'),
          relationships: val('create-relationships'),
          force_stances: Object.fromEntries(stances),
          goals:         collectGoals(),
        }),
      });
      const r = await res.json().catch(() => ({}));
      if (!r.success) throw new Error(r.message ?? r.error ?? 'Could not create character.');
      if (typeof mountLayout === 'function') await mountLayout().catch(() => {});
      location.href = r.session_url;
    } catch (e) {
      submitting = false;
      btn.disabled = false;
      btn.textContent = 'Begin';
      err.textContent = e.message;
      err.hidden = false;
    }
  }

  function unmount() {
    opts = null; sprites = []; spriteCdn = ''; selectedKey = null;
    spriteFilter = ''; submitting = false;
    goals.clear(); stances.clear();
  }

  window.Views = window.Views ?? {};
  window.Views.create = { mount, unmount };
})();
