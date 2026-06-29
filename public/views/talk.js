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
// The source walks the server-built tree via /api/talk. For devs, an optional
// dev bar overlays standing/faction/mood/hunts (passed as query params, gated
// server-side on isDev) so gated content can be walked without grinding state.

(function () {
  let source     = null;
  let current    = null;     // current NodeView
  let transcript = [];       // [{who:'npc',name,lines}|{who:'me',text}|{who:'sys',text}]
  let busy       = false;
  let containerEl = null;
  let onLeaveCb   = null;
  let devOv       = {};      // dev override params (empty for non-devs)
  let convoState  = { heat: 0 };  // conversation-local tension, round-tripped with the server

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mount(container, opts) {
    containerEl = container;
    onLeaveCb   = opts?.onLeave ?? null;
    devOv       = {};
    convoState  = { heat: 0 };
    source      = makeApiSource(opts?.npcId, devQuery);
    transcript  = [];
    const dev = !!(window.getLayoutData?.()?.is_dev);
    container.innerHTML = `
      <div class="conv">
        ${dev ? devBarHtml() : ''}
        <div class="conv-log"></div>
        <div class="conv-choices"></div>
      </div>`;
    if (dev) wireDevBar();
    document.addEventListener('keydown', onKey);
    start();
  }

  // ---- Dev bar (is_dev only) ---------------------------------------------
  function devBarHtml() {
    const sel = (id, label, opts) =>
      `<label class="conv-dev-field">${label}
        <select data-dev="${id}">${opts.map(o => `<option value="${o}">${o || '—'}</option>`).join('')}</select>
      </label>`;
    return `<div class="conv-dev">
      <span class="conv-dev-tag">dev</span>
      ${sel('as_standing', 'view', ['', 'stranger', 'regular', 'trusted', 'confidant'])}
      ${sel('as_faction', 'faction', ['', 'neutral', 'empire', 'town'])}
      <label class="conv-dev-field">mood <input type="number" min="0" max="10" data-dev="as_mood" class="conv-dev-num"></label>
      <label class="conv-dev-field">hunts <input type="text" data-dev="as_hunts" class="conv-dev-text" placeholder="lithkem_swallow"></label>
      <button type="button" class="conv-dev-dl" data-dev-dl>⬇ transcript</button>
    </div>`;
  }

  // Dump the running transcript (with node + heat annotations) for review.
  function downloadTranscript() {
    const ov = Object.entries(devOv).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
    const out = [`Dolan — conversation transcript`, `dev overrides: ${ov}`, ''];
    for (const e of transcript) {
      if (e.who === 'npc') {
        out.push(`Dolan [node=${e.node ?? '?'} heat=${e.heat ?? 0}]: ${(e.lines || []).join('\n       ')}`);
      } else if (e.who === 'me') {
        out.push(`  You: ${e.text}`);
      } else {
        out.push(`  (${e.text})`);
      }
    }
    const blob = new Blob([out.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dolan-conversation.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function wireDevBar() {
    for (const el of containerEl.querySelectorAll('[data-dev]')) {
      el.addEventListener('change', () => {
        const k = el.dataset.dev;
        const v = String(el.value).trim();
        if (v === '') delete devOv[k]; else devOv[k] = v;
        restart();
      });
    }
    containerEl.querySelector('[data-dev-dl]')?.addEventListener('click', downloadTranscript);
  }

  function devQuery() {
    const parts = Object.entries(devOv).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    return parts.length ? '?' + parts.join('&') : '';
  }

  async function start() {
    const opening = await source.open();
    if (!opening || opening.end) {
      const log = containerEl?.querySelector('.conv-log');
      if (log) log.innerHTML = `<p class="conv-empty">There is no one here to talk to.</p>`;
      const box = containerEl?.querySelector('.conv-choices');
      if (box) box.innerHTML = '';
      current = null;
      return;
    }
    current = opening;
    convoState = opening.convo || { heat: 0 };
    appendNpc(current);
    renderChoices();
  }

  function appendNpc(node) {
    const lines = Array.isArray(node.line) ? node.line : [node.line];
    transcript.push({ who: 'npc', name: node.npcName, lines, node: node.id, heat: convoState.heat });
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
      const next = await source.choose(current.id, idx, convoState);
      if (next && next.convo) convoState = next.convo;
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
    await start();
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
    containerEl = null; onLeaveCb = null; devOv = {}; convoState = { heat: 0 };
  }

  // ---- API source: walks the server-built tree via /api/talk -------------
  // Returns NodeView { id, npcName, line, options:[{label}], end:false } or
  // { end:true }. The server holds the relation state; we just render.
  function makeApiSource(npcId, queryFn) {
    const q = () => (queryFn ? queryFn() : '');
    return {
      async open() {
        try {
          const res = await fetch(`/api/talk/${encodeURIComponent(npcId)}${q()}`);
          if (!res.ok) return { end: true };
          return await res.json();
        } catch { return { end: true }; }
      },
      async choose(nodeId, idx, convo) {
        try {
          const res = await fetch(`/api/talk/${encodeURIComponent(npcId)}${q()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node: nodeId, optionIndex: idx, convo }),
          });
          if (!res.ok) return { end: true };
          return await res.json();
        } catch { return { end: true }; }
      },
    };
  }

  window.Conversation = { mount, unmount };
})();
