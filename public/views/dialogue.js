// Dialogue overlay — RPG-style NPC conversation box.
//
// Not a routed view; an overlay you open over whatever page you're on
// (e.g. the General Store). The player reads a line and picks from offered
// replies. Relationship state (opinion/standing/mood) is NEVER shown — the
// player only ever experiences it through what the NPC says and offers.
//
// Data comes from a "source" with two async methods:
//   source.open()              -> NodeView           (opening node)
//   source.choose(nodeId, idx) -> NodeView | {end}   (next node)
// where NodeView = { id, npcName, title, line, options:[{label}], end:false }.
//
// Today the source is a client-side MOCK so we can see the look. Swapping in
// the real engine later means replacing makeMockSource() with makeApiSource()
// that walks the server-built tree via /api/talk — the render loop is untouched.

(function () {
  let overlayEl = null;
  let source    = null;
  let current   = null;   // current NodeView
  let busy      = false;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- public entry ------------------------------------------------------
  async function open({ npcId }) {
    if (overlayEl) close();
    source = makeMockSource(npcId);          // ← swap to makeApiSource(npcId) when the engine lands
    buildShell();
    document.addEventListener('keydown', onKey);
    try {
      current = await source.open();
      render();
    } catch (_) {
      close();
    }
  }

  function buildShell() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'dlg-overlay';
    overlayEl.innerHTML = `
      <div class="dlg-card" role="dialog" aria-modal="true">
        <button class="dlg-close" aria-label="Leave conversation" title="Leave">×</button>
        <div class="dlg-speaker">
          <div class="dlg-portrait" aria-hidden="true"></div>
          <div class="dlg-speaker-meta">
            <span class="dlg-name"></span>
            <span class="dlg-title"></span>
          </div>
        </div>
        <div class="dlg-line"></div>
        <div class="dlg-options"></div>
      </div>`;
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) close();                 // click backdrop to leave
      if (e.target.closest('.dlg-close')) close();
    });
    document.body.appendChild(overlayEl);
    requestAnimationFrame(() => overlayEl.classList.add('show'));
  }

  function render() {
    if (!overlayEl || !current) return;
    const card = overlayEl.querySelector('.dlg-card');
    const lines = Array.isArray(current.line) ? current.line : [current.line];

    overlayEl.querySelector('.dlg-name').textContent  = current.npcName ?? '';
    overlayEl.querySelector('.dlg-title').textContent = current.title ?? '';
    const portrait = overlayEl.querySelector('.dlg-portrait');
    portrait.textContent = (current.npcName ?? '?').trim().charAt(0).toUpperCase();

    overlayEl.querySelector('.dlg-line').innerHTML =
      lines.map(l => `<p>${esc(l)}</p>`).join('');

    const opts = current.options ?? [];
    overlayEl.querySelector('.dlg-options').innerHTML = opts.length
      ? opts.map((o, i) => `
          <button class="dlg-option" data-idx="${i}">
            <span class="dlg-option-num">${i + 1}</span>
            <span class="dlg-option-text">${esc(o.label)}</span>
          </button>`).join('')
      : `<button class="dlg-option dlg-leave" data-idx="-1">
           <span class="dlg-option-text">Leave</span>
         </button>`;

    for (const btn of overlayEl.querySelectorAll('.dlg-option')) {
      btn.addEventListener('click', () => choose(parseInt(btn.dataset.idx, 10)));
    }
    // re-trigger the line fade each node
    card.classList.remove('dlg-step'); void card.offsetWidth; card.classList.add('dlg-step');
  }

  async function choose(idx) {
    if (busy || !source || !current) return;
    if (idx < 0) { close(); return; }          // the synthetic "Leave"
    busy = true;
    try {
      const next = await source.choose(current.id, idx);
      if (!next || next.end) { close(); return; }
      current = next;
      render();
    } finally {
      busy = false;
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    const n = parseInt(e.key, 10);
    if (!Number.isNaN(n) && n >= 1) {
      const btn = overlayEl?.querySelector(`.dlg-option[data-idx="${n - 1}"]`);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    if (overlayEl) {
      overlayEl.classList.remove('show');
      const el = overlayEl;
      setTimeout(() => el.remove(), 160);
    }
    overlayEl = null; source = null; current = null; busy = false;
  }

  // ---- MOCK source (placeholder until the engine is wired) ---------------
  // Mirrors the shape the real /api/talk will return. Copy lifted from
  // database/dialogue/dolan/general_store.yaml so the look reads true.
  const MOCK_TREES = {
    dolan: {
      npcName: 'Dolan',
      title: 'The Fifth Regiment General Store',
      start: 'greet',
      nodes: {
        greet: {
          line: 'Hunter. Are you here to buy something, or to wear out my floorboards?',
          options: [
            { label: 'Tell me about the Fifth.', goto: 'service' },
            { label: 'That permit’s already earning its keep.', goto: 'permit' },
            { label: 'This empire bleeds the town for taxes and calls it order.', goto: 'politics' },
            { label: 'Nothing today.', goto: 'end' },
          ],
        },
        service: {
          line: 'The Fifth held lines that mattered. Trade moved because we made it safe to move. That is the short version, and it is the one you get.',
          options: [
            { label: 'Why come home, then?', goto: 'whyback' },
            { label: 'Good of the empire.', goto: 'greet' },
          ],
        },
        whyback: {
          line: [
            'My mother fell ill. You go.',
            'The rest is that there was nowhere else the army still needed an old man. Was there anything you actually meant to buy?',
          ],
          options: [{ label: 'Fair enough.', goto: 'greet' }],
        },
        permit: {
          line: 'A permit, not a pile of bait — that was the point. Buy it once, hunt forever. Practical. The empire ran on paperwork like that.',
          options: [
            { label: 'What else should I be carrying?', goto: 'greet' },
            { label: 'Noted.', goto: 'end' },
          ],
        },
        politics: {
          line: 'That is not what you came in for. Did you come to trade, or to argue politics with an old soldier?',
          options: [
            { label: 'Debating. The empire’s boot is heavy here.', goto: 'rebuke' },
            { label: 'Buying. Forget I said it.', goto: 'greet' },
          ],
        },
        rebuke: {
          line: 'Heavy. You have never seen what light looks like, then. I have — villages that settled their disputes by opening a girl’s throat to the dirt. This town is chaos with the volume down: superstitious, filthy, and proud of both. That boot is the only reason you sleep soundly enough to resent it. Now — the counter, or the door.',
          options: [
            { label: 'The counter.', goto: 'greet' },
            { label: 'The door.', goto: 'end' },
          ],
        },
      },
    },
  };

  function makeMockSource(npcId) {
    const tree = MOCK_TREES[npcId];
    const view = (id) => {
      const n = tree.nodes[id];
      return { id, npcName: tree.npcName, title: tree.title, line: n.line,
        options: n.options.map(o => ({ label: o.label })), end: false };
    };
    return {
      async open() { return view(tree.start); },
      async choose(nodeId, idx) {
        const opt = tree.nodes[nodeId]?.options?.[idx];
        if (!opt || opt.goto === 'end') return { end: true };
        return view(opt.goto);
      },
    };
  }

  window.Dialogue = { open, close };
})();
