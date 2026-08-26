// Quests — the board for everyone, and the form for the GM.
//
// One view rather than two, because the GM has to see what players see while
// writing the thing they will see.
window.Views = window.Views || {};
window.Views.quests = (function () {

  let root = null;
  let state = { quests: [], isGm: false, characterId: null };
  let characters = [];

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const OBJECTIVES = [
    ['chop',    'Fell trees'],
    ['dig',     'Clear stumps'],
    ['kill',    'Defeat enemies'],
    ['deposit', 'Deliver items'],
    ['manual',  'Whatever we agreed (you mark it done)'],
  ];

  function describe(q) {
    switch (q.objective) {
      case 'chop':    return `Fell ${q.targetCount} trees`;
      case 'dig':     return `Clear ${q.targetCount} stumps`;
      case 'kill':    return `Defeat ${q.targetCount} ${q.targetKey || 'enemies'}`;
      case 'deposit': return `Deliver ${q.targetCount} ${q.targetKey || 'items'}`;
      default:        return 'As agreed with the GM';
    }
  }

  function rewardText(r) {
    const bits = [];
    if (r.korel) bits.push(`${r.korel} korel`);
    for (const [id, n] of Object.entries(r.items || {})) bits.push(`${n} ${id}`);
    for (const w of r.weapons || []) bits.push(w);
    return bits.length ? bits.join(', ') : 'nothing';
  }

  function remaining(iso) {
    if (!iso) return 'no time limit';
    const ms = new Date(iso) - Date.now();
    if (ms <= 0) return 'time up';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h >= 1 ? `${h}h ${m}m left` : `${m}m left`;
  }

  function questCard(q) {
    const pct = Math.min(100, Math.round((q.count / q.targetCount) * 100));
    const done = q.status !== 'active';
    // A group quest shows who has actually put something in. That is the whole
    // difference between a shared job and one person carrying it.
    const who = q.contributors.length
      ? `<p class="quest-who">${q.contributors.map(c =>
          `${esc(c.name)} ${c.count}`).join(' · ')}</p>`
      : '';
    return `
      <article class="quest-card ${done ? 'closed' : ''}">
        <div class="quest-head">
          <h3>${esc(q.title)}</h3>
          <span class="quest-tag">${q.scope === 'solo' ? 'Yours' : 'Town'}</span>
          ${done ? `<span class="quest-tag done">${esc(q.status)}</span>` : ''}
        </div>
        ${q.brief ? `<p class="quest-brief">${esc(q.brief)}</p>` : ''}
        <p class="quest-goal">${esc(describe(q))}</p>
        ${q.objective === 'manual' ? '' : `
          <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
          <p class="quest-count">${q.count} of ${q.targetCount}</p>`}
        ${who}
        <p class="quest-meta">Reward: ${esc(rewardText(q.reward))} · ${esc(remaining(q.endsAt))}</p>
        ${state.isGm && !done ? `
          <div class="quest-actions">
            <button class="quest-btn" data-complete="${q.id}">Mark done</button>
            <button class="quest-btn" data-cancel="${q.id}">Cancel</button>
          </div>` : ''}
      </article>`;
  }

  function gmForm() {
    return `
      <details class="quest-new">
        <summary>Hand out a quest</summary>
        <form id="quest-form">
          <label class="quest-label">Title
            <input class="quest-input" name="title" required maxlength="80"></label>
          <label class="quest-label">Brief
            <textarea class="quest-input" name="brief" rows="2" maxlength="400"></textarea></label>

          <div class="quest-row">
            <label class="quest-label">Objective
              <select class="quest-input" name="objective">
                ${OBJECTIVES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select></label>
            <label class="quest-label">How many
              <input class="quest-input" name="targetCount" type="number" min="1" value="10"></label>
          </div>

          <label class="quest-label" id="quest-key-wrap" hidden>Which one
            <input class="quest-input" name="targetKey" placeholder="enemy or item id"></label>

          <div class="quest-row">
            <label class="quest-label">Who
              <select class="quest-input" name="scope">
                <option value="group">The town (shared total)</option>
                <option value="solo">Named people (each their own)</option>
              </select></label>
            <label class="quest-label">Time limit (hours, 0 for none)
              <input class="quest-input" name="hours" type="number" min="0" value="0"></label>
          </div>

          <label class="quest-label" id="quest-who-wrap" hidden>Assign to
            <select class="quest-input" name="assignees" multiple size="4">
              ${characters.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
            <span class="quest-hint">Leave empty to open it to everyone.</span></label>

          <div class="quest-row">
            <label class="quest-label">Korel
              <input class="quest-input" name="korel" type="number" min="0" value="0"></label>
            <label class="quest-label">Items
              <input class="quest-input" name="items" placeholder="sulwood:5, talamite:2"></label>
            <label class="quest-label">Weapons
              <input class="quest-input" name="weapons" placeholder="axe_wood"></label>
          </div>

          <p class="quest-error" id="quest-error" hidden></p>
          <button class="quest-btn primary" type="submit">Issue it</button>
        </form>
      </details>`;
  }

  function parseItems(raw) {
    const out = {};
    for (const bit of String(raw || '').split(',')) {
      const [id, n] = bit.split(':').map(s => s.trim());
      if (id) out[id] = Math.max(1, Number(n || 1));
    }
    return out;
  }

  async function load() {
    const res = await fetch('/api/quests', { credentials: 'same-origin' });
    state = await res.json();
    if (state.isGm && !characters.length) {
      const r = await fetch('/api/quests/characters', { credentials: 'same-origin' });
      if (r.ok) characters = (await r.json()).characters;
    }
    render();
  }

  function render() {
    const open = state.quests.filter(q => q.status === 'active');
    const closed = state.quests.filter(q => q.status !== 'active');
    root.innerHTML = `
      <div class="quests-view">
        ${state.isGm ? gmForm() : ''}
        <h2 class="quests-heading">Open</h2>
        ${open.length ? open.map(questCard).join('') : '<p class="quest-empty">Nothing on the board.</p>'}
        ${closed.length ? `<h2 class="quests-heading">Finished</h2>${closed.map(questCard).join('')}` : ''}
      </div>`;
    wire();
  }

  function wire() {
    for (const b of root.querySelectorAll('[data-complete]')) {
      b.addEventListener('click', async () => {
        await fetch(`/api/quests/${b.dataset.complete}/complete`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        load();
      });
    }
    for (const b of root.querySelectorAll('[data-cancel]')) {
      b.addEventListener('click', async () => {
        await fetch(`/api/quests/${b.dataset.cancel}/cancel`, {
          method: 'POST', credentials: 'same-origin',
        });
        load();
      });
    }

    const form = root.querySelector('#quest-form');
    if (!form) return;

    // Only some objectives name a thing, and only named quests need a roster.
    const sync = () => {
      const objective = form.objective.value;
      root.querySelector('#quest-key-wrap').hidden = !['kill', 'deposit'].includes(objective);
      form.targetCount.disabled = objective === 'manual';
      root.querySelector('#quest-who-wrap').hidden = form.scope.value !== 'solo';
    };
    form.objective.addEventListener('change', sync);
    form.scope.addEventListener('change', sync);
    sync();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = root.querySelector('#quest-error');
      err.hidden = true;
      const body = {
        title: form.title.value,
        brief: form.brief.value,
        objective: form.objective.value,
        scope: form.scope.value,
        targetKey: form.targetKey.value || null,
        targetCount: Number(form.targetCount.value || 1),
        hours: Number(form.hours.value || 0),
        assignees: [...form.assignees.selectedOptions].map(o => o.value),
        reward: {
          korel: Number(form.korel.value || 0),
          items: parseItems(form.items.value),
          weapons: form.weapons.value.split(',').map(s => s.trim()).filter(Boolean),
        },
      };
      const result = await idyaPost('/api/quests', body);
      if (!result.ok) { err.textContent = result.error || 'Could not issue that.'; err.hidden = false; return; }
      form.reset();
      load();
    });
  }

  return {
    mount(el) { root = el; root.innerHTML = '<div class="splash"><p>Loading…</p></div>'; load(); },
    unmount() { root = null; },
  };
})();
