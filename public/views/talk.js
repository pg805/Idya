// View: Talk — NPC conversation as a chat page (transcript + choices).
//
// A full page, not an overlay: it lives in the content area like every other
// view, and keeps a running transcript so the conversation reads as history.
// Relationship state (opinion/standing/mood) is NEVER shown; the player only
// experiences it through which lines and choices the NPC gives.
//
// Data comes from a "source" with two async methods:
//   source.open()              -> NodeView           (opening node)
//   source.choose(nodeId, idx) -> NodeView | {end}   (next node)
// where NodeView = { id, npcName, title, line, options:[{label}], end:false }.
//
// Today the source is a client-side MOCK so we can see the look. Swapping in
// the real engine later means replacing makeMockSource() with makeApiSource()
// that walks the server-built tree via /api/talk; the page is untouched.

(function () {
  let npcId      = null;
  let source     = null;
  let current    = null;     // current NodeView
  let transcript = [];       // [{who:'npc',name,lines}|{who:'me',text}|{who:'sys',text}]
  let busy       = false;
  let rootEl     = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function mount(root, params) {
    rootEl     = root;
    npcId      = params.npcId;
    transcript = [];
    source     = makeMockSource(npcId);
    if (!source) {
      root.innerHTML = `<div class="splash"><p>There is no one here by that name.</p></div>`;
      return;
    }
    setLayoutTitle('Conversation');
    root.innerHTML = `
      <div class="talk-page">
        <header class="talk-head">
          <div class="talk-portrait" id="talk-portrait" aria-hidden="true"></div>
          <div class="talk-head-meta">
            <span class="talk-name" id="talk-name"></span>
            <span class="talk-title" id="talk-title"></span>
          </div>
          <span class="talk-preview-tag" title="Placeholder dialogue; the engine is not wired yet.">preview</span>
        </header>
        <div class="talk-log" id="talk-log"></div>
        <div class="talk-choices" id="talk-choices"></div>
      </div>`;
    document.addEventListener('keydown', onKey);

    current = await source.open();
    setLayoutTitle(current.npcName);
    document.getElementById('talk-name').textContent     = current.npcName ?? '';
    document.getElementById('talk-title').textContent    = current.title ?? '';
    document.getElementById('talk-portrait').textContent =
      (current.npcName ?? '?').trim().charAt(0).toUpperCase();

    appendNpc(current);
    renderChoices();
  }

  function appendNpc(node) {
    const lines = Array.isArray(node.line) ? node.line : [node.line];
    transcript.push({ who: 'npc', name: node.npcName, lines });
    renderLog();
  }
  function appendMe(text)  { transcript.push({ who: 'me',  text }); renderLog(); }
  function appendSys(text) { transcript.push({ who: 'sys', text }); renderLog(); }

  function renderLog() {
    const log = document.getElementById('talk-log');
    if (!log) return;
    log.innerHTML = transcript.map((e) => {
      if (e.who === 'npc') {
        return `<div class="talk-row npc">
            <div class="talk-bubble npc">
              <span class="talk-bubble-name">${esc(e.name)}</span>
              ${e.lines.map(l => `<p>${esc(l)}</p>`).join('')}
            </div>
          </div>`;
      }
      if (e.who === 'me') {
        return `<div class="talk-row me"><div class="talk-bubble me">${esc(e.text)}</div></div>`;
      }
      return `<div class="talk-sys">${esc(e.text)}</div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  function renderChoices() {
    const box = document.getElementById('talk-choices');
    if (!box) return;
    if (!current || current.end) {
      box.innerHTML = `
        <button class="talk-choice talk-end" data-act="again">
          <span class="talk-choice-text">Talk again</span></button>
        <button class="talk-choice talk-end" data-act="leave">
          <span class="talk-choice-text">Back to the store</span></button>`;
    } else {
      const opts = current.options ?? [];
      box.innerHTML = opts.map((o, i) => `
        <button class="talk-choice" data-idx="${i}">
          <span class="talk-choice-num">${i + 1}</span>
          <span class="talk-choice-text">${esc(o.label)}</span>
        </button>`).join('');
    }
    for (const btn of box.querySelectorAll('.talk-choice')) {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'leave') { leave(); return; }
        if (act === 'again') { restart(); return; }
        choose(parseInt(btn.dataset.idx, 10));
      });
    }
  }

  async function choose(idx) {
    if (busy || !current) return;
    const opt = current.options?.[idx];
    if (!opt) return;
    busy = true;
    try {
      appendMe(opt.label);
      const next = await source.choose(current.id, idx);
      if (!next || next.end) {
        current = { end: true };
        appendSys('Dolan turns back to his ledger.');
        renderChoices();
        return;
      }
      current = next;
      appendNpc(current);
      renderChoices();
    } finally {
      busy = false;
    }
  }

  async function restart() {
    transcript = [];
    current = await source.open();
    appendNpc(current);
    renderChoices();
  }

  function leave() {
    if (window.appNavigate) window.appNavigate('/shop/general_store');
  }

  function onKey(e) {
    if (busy) return;
    const n = parseInt(e.key, 10);
    if (!Number.isNaN(n) && n >= 1) {
      const btn = rootEl?.querySelector(`.talk-choice[data-idx="${n - 1}"]`);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  }

  function unmount() {
    document.removeEventListener('keydown', onKey);
    npcId = null; source = null; current = null; transcript = []; busy = false; rootEl = null;
  }

  // ---- MOCK source (placeholder until the engine is wired) ---------------
  // Mirrors what /api/talk will return. Copy lifted from
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
            { label: 'That permit is already earning its keep.', goto: 'permit' },
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
            'When your mother falls ill, you help her. That is the honorable thing to do.',
            'There was nowhere else the army still needed an old man, in any case. Was there something you actually meant to buy?',
          ],
          options: [{ label: 'Fair enough.', goto: 'greet' }],
        },
        permit: {
          line: 'A permit, not a pile of bait. That was the point. Buy it once and hunt forever. Practical. The empire ran on paperwork like that.',
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
          line: 'Heavy. Then you have never seen what light looks like. I have. I have watched villages settle their disputes by opening a girl’s throat over the dirt. This town is only chaos with the volume turned down: superstitious, filthy, and proud of both. That boot is the only reason you sleep soundly enough to resent it. Now then. The counter, or the door.',
          options: [
            { label: 'The counter.', goto: 'greet' },
            { label: 'The door.', goto: 'end' },
          ],
        },
      },
    },
  };

  function makeMockSource(id) {
    const tree = MOCK_TREES[id];
    if (!tree) return null;
    const view = (nid) => {
      const n = tree.nodes[nid];
      return { id: nid, npcName: tree.npcName, title: tree.title, line: n.line,
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

  window.Views = window.Views ?? {};
  window.Views.talk = { mount, unmount };
})();
