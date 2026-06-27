// Conversation — an embeddable NPC chat component (not a routed view).
//
// Mounts into a container (e.g. the shop's "Talk" tab) and renders a running
// transcript (NPC lines + the player's chosen replies) with numbered choices.
// Relationship state (opinion/standing/mood) is NEVER shown; the player only
// experiences it through which lines and choices the NPC gives.
//
// Data comes from a "source" with two async methods:
//   source.open()              -> NodeView           (opening node)
//   source.choose(nodeId, idx) -> NodeView | {end}   (next node)
// where NodeView = { id, npcName, line, options:[{label}], end:false }.
//
// Today the source is a client-side MOCK so we can see the look. Swapping in
// the real engine later means replacing makeMockSource() with makeApiSource()
// that walks the server-built tree via /api/talk; this component is untouched.

(function () {
  let source     = null;
  let current    = null;     // current NodeView
  let transcript = [];       // [{who:'npc',name,lines}|{who:'me',text}|{who:'sys',text}]
  let busy       = false;
  let containerEl = null;
  let onLeaveCb   = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mount(container, opts) {
    containerEl = container;
    onLeaveCb   = opts?.onLeave ?? null;
    source      = makeMockSource(opts?.npcId);
    transcript  = [];
    if (!source) {
      container.innerHTML = `<p class="conv-empty">There is no one here to talk to.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="conv">
        <div class="conv-log"></div>
        <div class="conv-choices"></div>
      </div>`;
    document.addEventListener('keydown', onKey);
    start();
  }

  async function start() {
    current = await source.open();
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
    const log = containerEl?.querySelector('.conv-log');
    if (!log) return;
    log.innerHTML = transcript.map((e) => {
      if (e.who === 'npc') {
        return `<div class="conv-row npc">
            <div class="conv-bubble npc">
              <span class="conv-bubble-name">${esc(e.name)}</span>
              ${e.lines.map(l => `<p>${esc(l)}</p>`).join('')}
            </div>
          </div>`;
      }
      if (e.who === 'me') {
        return `<div class="conv-row me"><div class="conv-bubble me">${esc(e.text)}</div></div>`;
      }
      return `<div class="conv-sys">${esc(e.text)}</div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;   // keep the latest line in view
  }

  function renderChoices() {
    const box = containerEl?.querySelector('.conv-choices');
    if (!box) return;
    if (!current || current.end) {
      const leaveBtn = onLeaveCb
        ? `<button class="conv-choice conv-end" data-act="leave">
             <span class="conv-choice-text">Back to the counter</span></button>`
        : '';
      box.innerHTML = `
        <button class="conv-choice conv-end" data-act="again">
          <span class="conv-choice-text">Talk again</span></button>
        ${leaveBtn}`;
    } else {
      const opts = current.options ?? [];
      box.innerHTML = opts.map((o, i) => `
        <button class="conv-choice" data-idx="${i}">
          <span class="conv-choice-num">${i + 1}</span>
          <span class="conv-choice-text">${esc(o.label)}</span>
        </button>`).join('');
    }
    for (const btn of box.querySelectorAll('.conv-choice')) {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'leave') { onLeaveCb?.(); return; }
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

  function isVisible() { return !!(containerEl && containerEl.offsetParent !== null); }

  function onKey(e) {
    if (busy || !isVisible()) return;
    const n = parseInt(e.key, 10);
    if (!Number.isNaN(n) && n >= 1) {
      const btn = containerEl.querySelector(`.conv-choice[data-idx="${n - 1}"]`);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  }

  function unmount() {
    document.removeEventListener('keydown', onKey);
    source = null; current = null; transcript = []; busy = false;
    containerEl = null; onLeaveCb = null;
  }

  // ---- MOCK source (placeholder until the engine is wired) ---------------
  // Mirrors what /api/talk will return. Copy lifted from
  // database/dialogue/dolan/general_store.yaml so the look reads true.
  const MOCK_TREES = {
    dolan: {
      npcName: 'Dolan',
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
      return { id: nid, npcName: tree.npcName, line: n.line,
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

  window.Conversation = { mount, unmount };
})();
