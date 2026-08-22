// Map view — draws a chunk of the world.
//
// Reuses paintTerrain from the combat board unchanged: it takes a board-shaped
// { terrain, obstacles } and two canvases, and it doesn't care whether a fight
// is happening on them. The combat board puts the DOM cell grid between the two
// canvases; here there is no grid, so they simply stack.
//
// Movement is server-authoritative: a click or a keypress asks to walk, and the
// server answers with a path that everyone in the chunk is shown.
window.Views = window.Views || {};
window.Views.map = (function () {

  const TILE_SRC = 32;      // the tileset's native tile size
  const STEP_MS = 130;      // time to cross one tile, so a walk reads as walking
  let chunk = { x: 0, y: 0 };
  let view = null;          // the loaded ChunkView
  let root = null;
  let onResize = null;
  let socket = null;
  let meId = null;
  let cell = TILE_SRC;
  const occupants = new Map();   // socket id -> { name, sprite, tile, el }
  const walks = new Map();       // socket id -> in-flight walk, so a new one joins on
  // Where the SERVER thinks we are, which is the end of the last accepted walk
  // rather than wherever the token has animated to. Steps have to be pathed from
  // here or a held key would ask to move from a square we have already left.
  let myTile = null;
  let held = null;               // { dx, dy } while an arrow is down
  let stepTimer = null;
  let onKeyDown = null;
  let onKeyUp = null;
  let onBlur = null;

  const KEYS = {
    ArrowUp: { dx: 0, dy: -1 }, ArrowRight: { dx: 1, dy: 0 },
    ArrowDown: { dx: 0, dy: 1 }, ArrowLeft: { dx: -1, dy: 0 },
    w: { dx: 0, dy: -1 }, d: { dx: 1, dy: 0 },
    s: { dx: 0, dy: 1 }, a: { dx: -1, dy: 0 },
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Tile size in CSS pixels.
   *
   * Whole numbers only. A fractional cell would put the 32px source art on
   * half-pixel boundaries and the whole thing would shimmer.
   */
  function cellSizeFor(availablePx) {
    const fit = Math.floor(availablePx / (view?.size || 24));
    return Math.max(8, Math.min(TILE_SRC, fit));
  }

  function paint() {
    if (!view || !root) return;
    const stage = root.querySelector('#map-stage');
    if (!stage) return;

    cell = cellSizeFor(stage.parentElement.clientWidth || 768);
    const px = cell * view.size;
    stage.style.width = `${px}px`;
    stage.style.height = `${px}px`;

    const canvases = {
      ground: stage.querySelector('#map-ground'),
      canopy: stage.querySelector('#map-canopy'),
    };

    const painted = paintTerrain(
      canvases,
      { terrain: view.terrain, obstacles: view.obstacles },
      cell,
      { onReady: () => paint() },   // sheets may still be loading on first paint
    );

    stage.classList.toggle('loading', !painted);
    root.querySelector('#map-scale').textContent =
      `${view.size}x${view.size} tiles, drawn at ${cell}px`;

    // Tokens are sized and repositioned in the same units the canvases just
    // used, so a resize moves everyone with the ground under them.
    for (const [id, o] of occupants) placeToken(id, o.tile, false);
  }

  // ---- people ----

  function tokenLayer() {
    return root?.querySelector('#map-tokens') ?? null;
  }

  function ensureToken(id, o) {
    const layer = tokenLayer();
    if (!layer) return null;
    let entry = occupants.get(id);
    if (entry?.el?.isConnected) { Object.assign(entry, o); return entry; }

    const el = document.createElement('div');
    el.className = 'map-token' + (id === meId ? ' me' : '');
    el.innerHTML =
      (o.sprite
        ? `<img class="map-token-sprite" src="${spriteUrl(o.sprite)}" alt="">`
        : '<div class="map-token-blank"></div>') +
      `<span class="map-token-name"></span>`;
    el.querySelector('.map-token-name').textContent = o.name;
    layer.appendChild(el);

    entry = { ...o, el };
    occupants.set(id, entry);
    return entry;
  }

  function spriteUrl(token) {
    const cdn = window.getLayoutData?.()?.spriteCdn;
    return cdn ? `${cdn}/${token}.png` : `/sprites/${token}.png`;
  }

  function placeToken(id, tile, animate) {
    const entry = occupants.get(id);
    if (!entry?.el) return;
    entry.tile = tile;
    entry.el.style.transitionDuration = animate ? `${STEP_MS}ms` : '0ms';
    entry.el.style.width = `${cell}px`;
    entry.el.style.height = `${cell}px`;
    entry.el.style.transform = `translate(${tile.x * cell}px, ${tile.y * cell}px)`;
  }

  /**
   * Walk a token along a path, one tile at a time.
   *
   * A new path arriving mid-walk is appended to whatever is left of the old
   * one rather than replacing it. The server moves you the instant it accepts a
   * walk, so a second click is pathed from where you will END UP, not from where
   * your token currently is. Replacing outright makes the token snap forward to
   * the old destination before setting off again; continuing through the
   * remainder joins the two walks up, because the new path starts adjacent to
   * exactly the square the old one finished on.
   */
  function walkToken(id, path) {
    const active = walks.get(id);
    const queue = active ? active.remaining().concat(path) : path.slice();
    if (active) clearTimeout(active.timer);

    let i = 0;
    const state = {
      timer: null,
      remaining: () => queue.slice(i),
    };
    walks.set(id, state);

    const step = () => {
      if (i >= queue.length) { walks.delete(id); return; }
      placeToken(id, queue[i++], true);
      // Chained timeouts rather than an interval: an interval drifts against
      // the CSS transition and the steps start to stutter.
      state.timer = setTimeout(step, STEP_MS);
    };
    step();
  }

  function stopWalk(id) {
    const active = walks.get(id);
    if (active) clearTimeout(active.timer);
    walks.delete(id);
  }

  // ---- keyboard ----

  function stepHeld() {
    if (!held || !socket || !myTile || !view) return;
    const to = { x: myTile.x + held.dx, y: myTile.y + held.dy };
    if (to.x < 0 || to.y < 0 || to.x >= view.size || to.y >= view.size) return;
    socket.emit('world:walk', to);
    // Assume it lands. Holding a key steps faster than a round trip, so waiting
    // for the answer would ask to move from a square we have already left, and
    // the server would path us somewhere strange. A refusal resyncs below.
    myTile = to;
  }

  function beginHold(dir) {
    if (held && held.dx === dir.dx && held.dy === dir.dy) return;  // key repeat
    held = dir;
    stepHeld();
    clearInterval(stepTimer);
    // Paced to the animation, so holding a key walks at the same speed as
    // clicking a distant tile instead of racing ahead of the tokens.
    stepTimer = setInterval(stepHeld, STEP_MS);
  }

  function endHold() {
    held = null;
    clearInterval(stepTimer);
    stepTimer = null;
  }

  function bindKeys() {
    onKeyDown = (e) => {
      // Never steal keys from something being typed into.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const dir = KEYS[e.key] ?? KEYS[e.key?.toLowerCase?.()];
      if (!dir) return;
      e.preventDefault();   // arrows would otherwise scroll the page
      beginHold(dir);
    };
    onKeyUp = (e) => {
      const dir = KEYS[e.key] ?? KEYS[e.key?.toLowerCase?.()];
      if (!dir) return;
      // Only stop if the released key is the one being held; releasing a
      // different arrow mid-turn shouldn't halt the current direction.
      if (held && held.dx === dir.dx && held.dy === dir.dy) endHold();
    };
    // Losing focus mid-hold would otherwise leave the character walking forever.
    onBlur = () => endHold();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  function unbindKeys() {
    endHold();
    if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
    if (onKeyUp) document.removeEventListener('keyup', onKeyUp);
    if (onBlur) window.removeEventListener('blur', onBlur);
    onKeyDown = onKeyUp = onBlur = null;
  }

  function syncOccupants(list) {
    const seen = new Set();
    for (const o of list) {
      seen.add(o.id);
      const existing = occupants.get(o.id);
      ensureToken(o.id, o);
      // Don't yank somebody back to the server's idea of their square while
      // they're mid-walk; the walk ends there anyway.
      if (!existing || !walks.has(o.id)) placeToken(o.id, o.tile, false);
    }
    for (const [id, entry] of [...occupants]) {
      if (seen.has(id)) continue;
      stopWalk(id);
      entry.el?.remove();
      occupants.delete(id);
    }
    const count = occupants.size;
    const here = root?.querySelector('#map-here');
    if (here) here.textContent = count === 1 ? 'Just you here.' : `${count} here.`;
  }

  function clearTokens() {
    for (const id of [...walks.keys()]) stopWalk(id);
    for (const o of occupants.values()) o.el?.remove();
    occupants.clear();
  }

  async function load(next) {
    chunk = next;
    const body = root.querySelector('#map-body');
    body.innerHTML = '<p class="map-note">Loading…</p>';

    let data;
    try {
      const res = await fetch(`/api/world/chunk?x=${chunk.x}&y=${chunk.y}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch (_) {
      body.innerHTML = '<p class="map-note">Nothing is there.</p>';
      return;
    }

    view = data;

    // Tokens sit between the two canvases: on the ground, under the leaves.
    body.innerHTML = `
      <div class="map-stage-wrap">
        <div id="map-stage" class="map-stage loading">
          <canvas id="map-ground"></canvas>
          <div id="map-tokens" class="map-tokens"></div>
          <canvas id="map-canopy"></canvas>
        </div>
      </div>`;

    const stage = body.querySelector('#map-stage');
    stage.addEventListener('click', (e) => {
      if (!socket || !view) return;
      const r = stage.getBoundingClientRect();
      const tile = {
        x: Math.floor((e.clientX - r.left) / cell),
        y: Math.floor((e.clientY - r.top) / cell),
      };
      if (tile.x < 0 || tile.y < 0 || tile.x >= view.size || tile.y >= view.size) return;
      socket.emit('world:walk', tile);
    });

    root.querySelector('#map-place').textContent = view.place.name;
    root.querySelector('#map-blurb').textContent = view.place.blurb;
    root.querySelector('#map-coords').textContent = `(${chunk.x}, ${chunk.y})`;

    const exits = root.querySelector('#map-exits');
    exits.innerHTML = view.exits.length
      ? view.exits.map(e =>
          `<button class="map-exit" data-x="${e.x}" data-y="${e.y}">Go to ${esc(e.name)}</button>`,
        ).join('')
      : '<span class="map-note">Nowhere to go from here.</span>';
    for (const btn of exits.querySelectorAll('.map-exit')) {
      // Travel goes through the server: it moves your character, not just the
      // camera, so everyone in both places sees you leave and arrive.
      btn.addEventListener('click', () => {
        socket?.emit('world:travel', { x: +btn.dataset.x, y: +btn.dataset.y });
      });
    }

    paint();
  }

  function connect() {
    socket = io();

    socket.on('connect', () => socket.emit('world:join'));

    socket.on('world:you', async (me) => {
      meId = me.id;
      myTile = me.tile;
      // The server decides where you are; the client follows it there.
      if (!view || view.chunk.x !== me.chunk.x || view.chunk.y !== me.chunk.y) {
        clearTokens();
        await load(me.chunk);
      }
      socket.emit('world:join');   // ask for the occupant list in the new chunk
    });

    socket.on('world:here', (data) => {
      if (!view || data.chunk.x !== view.chunk.x || data.chunk.y !== view.chunk.y) return;
      syncOccupants(data.occupants);
    });

    socket.on('world:walked', ({ id, path }) => {
      if (!path?.length) return;
      // The server accepted it, so that's where we are now even though the
      // token is still catching up.
      if (id === meId) myTile = path[path.length - 1];
      if (!occupants.has(id)) return;
      walkToken(id, path);
    });

    socket.on('world:error', (e) => {
      // We may have guessed wrong about where we are; ask for the truth.
      endHold();
      socket.emit('world:join');
      const note = root?.querySelector('#map-error');
      if (!note) return;
      note.textContent = e.message;
      note.hidden = false;
      clearTimeout(note._t);
      note._t = setTimeout(() => { note.hidden = true; }, 2500);
    });
  }

  function mount(el) {
    root = el;
    root.innerHTML = `
      <div class="map-view">
        <div class="map-head">
          <h2 class="map-place" id="map-place">…</h2>
          <span class="map-coords" id="map-coords"></span>
        </div>
        <p class="map-blurb" id="map-blurb"></p>

        <p class="map-hint">Click a square to walk there, or use the arrow keys.</p>
        <div class="map-exits" id="map-exits"></div>
        <div id="map-body"></div>
        <div class="map-foot">
          <span class="map-here" id="map-here"></span>
          <span class="map-scale" id="map-scale"></span>
        </div>
        <p class="map-error" id="map-error" hidden></p>
      </div>`;

    onResize = () => paint();
    window.addEventListener('resize', onResize);
    bindKeys();
    connect();
  }

  function unmount() {
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = null;
    unbindKeys();
    myTile = null;
    clearTokens();
    if (socket) { socket.disconnect(); socket = null; }
    meId = null;
    view = null;
    root = null;
  }

  return { mount, unmount };
})();
