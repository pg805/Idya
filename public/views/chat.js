// Chat view — in character, and scoped to where you are standing.
//
// There is no global channel and no guild channel by design (docs/world.md §2).
// You hear what is said in your location, and arriving does not hand you a
// transcript of what you missed: the log starts when you do. History is kept in
// the database for the GM and for moderation, not to be replayed here.
window.Views = window.Views || {};
window.Views.chat = (function () {

  let socket = null;
  let current = null;   // { x, y }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function time(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function atBottom(log) {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  }

  function append(root, html) {
    const log = root.querySelector('#chat-log');
    if (!log) return;
    const stick = atBottom(log);
    log.insertAdjacentHTML('beforeend', html);
    // Only auto-scroll if they were already at the bottom, so reading back
    // doesn't get yanked away every time somebody speaks.
    if (stick) log.scrollTop = log.scrollHeight;
  }

  function line(msg, mine) {
    return `<p class="chat-line${mine ? ' mine' : ''}">` +
      `<span class="chat-time">${time(msg.at)}</span> ` +
      `<span class="chat-who">${esc(msg.characterName)}</span> ` +
      `<span class="chat-body">${esc(msg.body)}</span></p>`;
  }

  function system(root, text) {
    append(root, `<p class="chat-system">${esc(text)}</p>`);
  }

  function renderPlaces(root, places) {
    const sel = root.querySelector('#chat-place');
    if (!sel) return;
    sel.innerHTML = places
      .map(p => `<option value="${p.x},${p.y}">${esc(p.name)}</option>`)
      .join('');
    if (current) sel.value = `${current.x},${current.y}`;
  }

  function mount(root) {
    root.innerHTML = `
      <div class="chat-view">
        <div class="chat-bar">
          <select id="chat-place" class="chat-select" aria-label="Where you are"></select>
          <span class="chat-here" id="chat-here"></span>
        </div>

        <div class="chat-log" id="chat-log"></div>

        <form class="chat-form" id="chat-form">
          <input class="chat-input" id="chat-input" type="text" autocomplete="off"
                 maxlength="500" placeholder="Say something">
          <button class="chat-send" type="submit">Say</button>
        </form>
      </div>`;

    socket = io();

    socket.on('connect', () => socket.emit('chat:join'));

    socket.on('chat:joined', (data) => {
      current = data.chunk;
      renderPlaces(root, data.places);
      system(root, `You are in ${data.place?.name ?? 'nowhere in particular'}. ` +
                   `You will hear what is said here while you are present.`);
    });

    socket.on('chat:place', (data) => {
      current = data.chunk;
      const sel = root.querySelector('#chat-place');
      if (sel) sel.value = `${data.chunk.x},${data.chunk.y}`;
      system(root, `You are in ${data.place?.name ?? 'nowhere in particular'}.`);
    });

    socket.on('chat:presence', (data) => {
      if (!current || data.chunk.x !== current.x || data.chunk.y !== current.y) return;
      const here = root.querySelector('#chat-here');
      if (!here) return;
      here.textContent = data.here.length
        ? `Here: ${data.here.join(', ')}`
        : 'Nobody else is here.';
    });

    socket.on('chat:message', (msg) => {
      append(root, line(msg, false));
    });

    socket.on('chat:error', (e) => system(root, e.message));

    socket.on('disconnect', () => system(root, 'Disconnected.'));

    root.querySelector('#chat-place').addEventListener('change', (e) => {
      const [x, y] = e.target.value.split(',').map(Number);
      socket.emit('chat:move', { x, y });
    });

    root.querySelector('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = root.querySelector('#chat-input');
      const body = input.value;
      if (!body.trim()) return;
      socket.emit('chat:send', { body });
      input.value = '';
      input.focus();
    });
  }

  function unmount() {
    if (socket) { socket.disconnect(); socket = null; }
    current = null;
  }

  return { mount, unmount };
})();
