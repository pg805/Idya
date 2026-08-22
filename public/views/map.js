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
  // Every direction key currently down, not just the latest. Holding two is how
  // you go diagonally, so the last one pressed must not replace the first.
  const heldKeys = new Map();    // key -> { dx, dy }
  let stepTimer = null;
  let onKeyDown = null;
  let onKeyUp = null;
  let onBlur = null;
  const world = document.getElementById('world-root');
  let lastResync = 0;

  const ZOOM_KEY = 'idya.map_zoom';
  let zoom = (() => {
    try {
      const raw = localStorage.getItem(ZOOM_KEY);
      if (raw === 'fit') return 'fit';
      const n = Number(raw);
      return n === 1 || n === 2 || n === 3 ? n : 'fit';
    } catch (_) { return 'fit'; }
  })();

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
  /**
   * Tile size in CSS pixels.
   *
   * Measured from the viewport the board sits in, which flex has already sized;
   * an earlier version derived it from the stage's own height, which made the
   * map shrink a little on every repaint.
   *
   * Whole numbers only. A fractional cell puts the 32px source art on half-pixel
   * boundaries and the whole thing shimmers.
   */
  function cellSizeFor() {
    const size = view?.size || 24;
    if (zoom !== 'fit') return TILE_SRC * zoom;
    const wrap = root?.querySelector('.map-stage-wrap');
    // Before first layout these read 0; fitting to that would pick the floor
    // and the board would look absent rather than small.
    const width = wrap?.clientWidth || 768;
    const height = wrap?.clientHeight || width;
    const fit = Math.floor(Math.min(width, height) / size);
    return Math.max(12, Math.min(TILE_SRC, fit));
  }

  /**
   * Scroll the board so you stay in the middle of the viewport.
   *
   * At anything past 1x a 24x24 chunk is wider than the window, so the choice
   * is between seeing all of it small and seeing part of it properly. This is
   * the second: the view follows you, and stops at the edges rather than
   * showing empty space past them. A board that fits is simply centred.
   */
  function updateCamera(animate) {
    const wrap = root?.querySelector('.map-stage-wrap');
    const stage = root?.querySelector('#map-stage');
    if (!wrap || !stage || !view) return;

    const boardPx = cell * view.size;
    const me = occupants.get(meId);
    const axis = (viewportPx, focusTile) => {
      if (boardPx <= viewportPx) return (viewportPx - boardPx) / 2;   // centre it
      if (!me) return 0;
      const wanted = focusTile * cell + cell / 2 - viewportPx / 2;
      return -Math.max(0, Math.min(wanted, boardPx - viewportPx));
    };

    stage.style.transitionDuration = animate ? `${STEP_MS}ms` : '0ms';
    stage.style.transform =
      `translate(${axis(wrap.clientWidth, me?.tile.x ?? 0)}px, ` +
      `${axis(wrap.clientHeight, me?.tile.y ?? 0)}px)`;
  }

  function setZoom(next) {
    zoom = next;
    try { localStorage.setItem(ZOOM_KEY, String(next)); } catch (_) {}
    paint();
    for (const btn of root?.querySelectorAll('.map-zoom-btn') ?? []) {
      btn.classList.toggle('active', btn.dataset.zoom === String(next));
    }
  }

  function paint() {
    if (!view || !root) return;
    const stage = root.querySelector('#map-stage');
    if (!stage) return;

    cell = cellSizeFor();
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
    updateCamera(false);
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
    // The view rides along with you, at the same pace as the step.
    if (id === meId) updateCamera(animate);
  }

  /**
   * Walk a token along a path, one tile at a time.
   *
   * A path arriving while one is already running is APPENDED to it rather than
   * replacing it, and the existing timer keeps its cadence. Two reasons:
   *
   * The server moves you the instant it accepts a walk, so a second click is
   * pathed from where you will END UP rather than from where your token is.
   * Replacing outright snaps the token to the old destination before setting
   * off again; continuing joins the two up, because the new path starts
   * adjacent to exactly the square the old one finished on.
   *
   * And restarting the stepper on each arrival makes a held arrow key stutter:
   * every message fires a step immediately, so two landing close together are
   * drawn back to back and the walk lurches. Letting one timer own the pace
   * keeps every step the same length regardless of when its message arrived.
   */
  function walkToken(id, path) {
    const active = walks.get(id);
    if (active) { active.queue.push(...path); return; }

    const state = { queue: path.slice(), i: 0, timer: null };
    walks.set(id, state);

    const step = () => {
      if (state.i >= state.queue.length) { walks.delete(id); return; }
      placeToken(id, state.queue[state.i++], true);
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

  /** The combined direction of everything held. Opposites cancel. */
  function currentDir() {
    let dx = 0, dy = 0;
    for (const d of heldKeys.values()) { dx += d.dx; dy += d.dy; }
    return { dx: Math.sign(dx), dy: Math.sign(dy) };
  }

  function stepHeld() {
    if (!heldKeys.size || !socket || !myTile || !view) return;
    const dir = currentDir();
    if (dir.dx === 0 && dir.dy === 0) return;   // pressing both ways at once
    const to = { x: myTile.x + dir.dx, y: myTile.y + dir.dy };
    if (to.x < 0 || to.y < 0 || to.x >= view.size || to.y >= view.size) return;
    // A step, not a walk: pressing right into a tree should stop you against
    // it, not route you around it.
    socket.emit('world:step', to);
    // Assume it lands. Holding a key steps faster than a round trip, so waiting
    // for the answer would ask to move from a square we have already left, and
    // the server would path us somewhere strange. A refusal corrects it.
    myTile = to;
  }

  function beginHold(key, dir) {
    if (heldKeys.has(key)) return;                 // OS key repeat
    const wasIdle = heldKeys.size === 0;
    heldKeys.set(key, dir);
    // Adding a second direction changes where the next step goes, but it must
    // not restart the clock, or tapping into a diagonal stutters.
    if (!wasIdle) return;
    stepHeld();
    clearInterval(stepTimer);
    // Paced to the animation, so holding a key walks at the same speed as
    // clicking a distant tile instead of racing ahead of the tokens.
    stepTimer = setInterval(stepHeld, STEP_MS);
  }

  function releaseHold(key) {
    heldKeys.delete(key);
    if (heldKeys.size === 0) endHold();
  }

  function endHold() {
    heldKeys.clear();
    clearInterval(stepTimer);
    stepTimer = null;
  }

  const keyName = (e) => (KEYS[e.key] ? e.key : e.key?.toLowerCase?.());

  function bindKeys() {
    onKeyDown = (e) => {
      // Never steal keys from something being typed into.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = keyName(e);
      const dir = KEYS[key];
      if (!dir) return;
      e.preventDefault();   // arrows would otherwise scroll the page
      beginHold(key, dir);
    };
    onKeyUp = (e) => {
      const key = keyName(e);
      if (!KEYS[key]) return;
      // Releasing one of two held keys drops back to the other rather than
      // stopping, so letting go of Up mid-diagonal keeps you going right.
      releaseHold(key);
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
      const isNew = !occupants.has(o.id);
      ensureToken(o.id, o);

      // A presence update is a statement about where people ARE, which during a
      // walk is the far end of a path the token is still crossing. Applying it
      // would teleport them to the destination and then the walk would carry on
      // from the beginning.
      if (walks.has(o.id)) continue;

      // For our own token the server is echoing a position we already know
      // about, so only move if it genuinely disagrees; otherwise every update
      // is a chance to stutter.
      if (o.id === meId && !isNew && myTile
          && o.tile.x === myTile.x && o.tile.y === myTile.y) continue;

      placeToken(o.id, o.tile, false);
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
      // Deliberately does NOT ask again: the server broadcasts the occupant
      // list as part of handling world:join, and re-asking from inside the
      // reply is an infinite round trip that floods world:here and snaps every
      // token on each one.
    });

    socket.on('world:here', (data) => {
      if (!view || data.chunk.x !== view.chunk.x || data.chunk.y !== view.chunk.y) return;
      syncOccupants(data.occupants);
    });

    socket.on('world:walked', ({ id, from, path }) => {
      if (!path?.length) return;
      // The server accepted it, so that's where we are now even though the
      // token is still catching up.
      if (id === meId) myTile = path[path.length - 1];
      if (!occupants.has(id)) return;

      // The walk begins where the server says it begins. If our token has
      // drifted from that (a refused step we had already assumed, a missed
      // update), put it right with no animation first, so the walk itself is
      // never seen starting from the wrong square.
      const entry = occupants.get(id);
      if (from && !walks.has(id) && entry?.tile
          && (entry.tile.x !== from.x || entry.tile.y !== from.y)) {
        placeToken(id, from, false);
      }
      walkToken(id, path);
    });

    // A step that ran into something. Nothing moves; we just stop pressing.
    socket.on('world:blocked', () => {
      endHold();
      const me = occupants.get(meId);
      if (me) myTile = me.tile;   // our optimistic guess was wrong
    });

    socket.on('world:error', (e) => {
      // Our optimistic guess may have been wrong. Stop walking and ask once;
      // the throttle keeps a wall we're pressed against from becoming a flood.
      endHold();
      const now = Date.now();
      if (now - lastResync > 1000) { lastResync = now; socket.emit('world:join'); }
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
          <span class="map-zoom">
            <button class="map-zoom-btn" type="button" data-zoom="fit">Fit</button>
            <button class="map-zoom-btn" type="button" data-zoom="2">2x</button>
            <button class="map-zoom-btn" type="button" data-zoom="3">3x</button>
          </span>
          <span class="map-scale" id="map-scale"></span>
        </div>
        <p class="map-error" id="map-error" hidden></p>
      </div>`;

    for (const btn of root.querySelectorAll('.map-zoom-btn')) {
      btn.classList.toggle('active', btn.dataset.zoom === String(zoom));
      btn.addEventListener('click', () => {
        const v = btn.dataset.zoom;
        setZoom(v === 'fit' ? 'fit' : Number(v));
      });
    }

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
