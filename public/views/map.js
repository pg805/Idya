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
  // Where the server says we are, and the most recent occupant list for it.
  // Both are tracked outside the loaded view because travelling has a window
  // where the server has already moved us but the new stage is still being
  // fetched, and a list arriving in that window must not be judged against the
  // place we just left.
  let myChunk = null;
  let latestOccupants = null;
  // Every direction key currently down, not just the latest. Holding two is how
  // you go diagonally, so the last one pressed must not replace the first.
  const heldKeys = new Map();    // key -> { dx, dy }
  let stepTimer = null;
  // Two keys meant as one diagonal never land in the same event. Waiting this
  // long before the FIRST step lets the second arrive and be counted, which is
  // the difference between going diagonally and going straight and then
  // diagonally. Short enough not to read as input lag next to a 130ms step.
  const DIAGONAL_GRACE_MS = 55;
  let graceTimer = null;
  let onKeyDown = null;
  let onKeyUp = null;
  let onBlur = null;
  const world = document.getElementById('world-root');
  let lastResync = 0;
  let selectedSprite = 'dec_fire_01';
  let gmPanel = null;
  let gmToggle = null;
  let rotation = 0;        // quarter turns applied to the next placement
  let flipped = false;     // mirrored left to right

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
      { terrain: view.terrain, obstacles: view.obstacles, objects: view.objects },
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

  /**
   * Record who somebody is, and give them a token if there's somewhere to put
   * one yet.
   *
   * The record is kept whether or not the DOM is ready. Travelling rebuilds the
   * stage, and the server's occupant list can easily arrive while that rebuild
   * is still awaiting its fetch; holding the data separately means the tokens
   * can simply be drawn again afterwards instead of being lost with the layer
   * that was replaced underneath them.
   */
  function ensureToken(id, o) {
    let entry = occupants.get(id);
    if (entry) Object.assign(entry, o);
    else { entry = { ...o, el: null }; occupants.set(id, entry); }

    const layer = tokenLayer();
    if (!layer) return entry;                       // drawn later, by renderTokens
    if (entry.el?.isConnected) return entry;

    const el = document.createElement('div');
    el.className = 'map-token' + (id === meId ? ' me' : '');
    el.innerHTML =
      (o.sprite
        ? `<img class="map-token-sprite" src="${spriteUrl(o.sprite)}" alt="">`
        : '<div class="map-token-blank"></div>') +
      `<span class="map-token-name"></span>`;
    el.querySelector('.map-token-name').textContent = o.name;
    layer.appendChild(el);
    entry.el = el;
    return entry;
  }

  /** Draw everyone we know about into the current layer. Safe to call twice. */
  function renderTokens() {
    if (!tokenLayer()) return;
    for (const [id, o] of occupants) {
      ensureToken(id, o);
      // o.tile is kept current by placeToken as tokens walk, so this redraws
      // where they actually are rather than where the last list said.
      if (!walks.has(id)) placeToken(id, o.tile, false);
    }
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
    // not restart the clock, or easing into a diagonal stutters.
    if (!wasIdle) return;

    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => {
      graceTimer = null;
      startStepping();
    }, DIAGONAL_GRACE_MS);
  }

  function startStepping() {
    stepHeld();
    clearInterval(stepTimer);
    // Paced to the animation, so holding a key walks at the same speed as
    // clicking a distant tile instead of racing ahead of the tokens.
    stepTimer = setInterval(stepHeld, STEP_MS);
  }

  function releaseHold(key) {
    // A tap shorter than the grace window would otherwise be swallowed: the
    // first step hasn't fired yet and the key is already going up. Take it now,
    // while the direction is still held.
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; stepHeld(); }
    heldKeys.delete(key);
    if (heldKeys.size === 0) endHold();
  }

  function endHold() {
    heldKeys.clear();
    clearTimeout(graceTimer);
    graceTimer = null;
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
      // Rotate, while a tool is up. Deliberately not one of the movement keys,
      // and only meaningful when there is something to rotate.
      if ((e.key === 'r' || e.key === 'R') && tool) {
        e.preventDefault();
        rotateStep();
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && tool) {
        e.preventDefault();
        flipStep();
        return;
      }
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
      const entry = ensureToken(o.id, o);
      if (!entry?.el) continue;    // no stage yet; renderTokens will place it

      // The list says WHO is here. Where they are comes from walks, which are
      // live; the list is only sent on joins and departures, so its positions
      // are as old as the last one of those. Repositioning from it threw
      // everybody back to where they stood when somebody last arrived, which is
      // what made chopping look like it teleported you.
      if (!isNew) continue;

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

    const tileAt = (e) => {
      const r = stage.getBoundingClientRect();
      return {
        x: Math.floor((e.clientX - r.left) / cell),
        y: Math.floor((e.clientY - r.top) / cell),
      };
    };
    const inBoard = (t) => t.x >= 0 && t.y >= 0 && t.x < view.size && t.y < view.size;

    stage.addEventListener('mousemove', (e) => {
      const t = tileAt(e);
      if (!inBoard(t)) return updateCursor(null);
      if (tool) return updateCursor(t);
      // No tool up: the only thing worth outlining is something you could work.
      updateCursor(workableAt(t) ? t : null, 'work');
    });
    stage.addEventListener('mouseleave', () => updateCursor(null));

    stage.addEventListener('click', (e) => {
      if (!socket || !view) return;
      const r = stage.getBoundingClientRect();
      const tile = {
        x: Math.floor((e.clientX - r.left) / cell),
        y: Math.floor((e.clientY - r.top) / cell),
      };
      if (tile.x < 0 || tile.y < 0 || tile.x >= view.size || tile.y >= view.size) return;
      if (applyTool(tile)) return;
      // Clicking a tree you are standing next to means working it, not trying
      // to walk into it, which is what that click did before: fail.
      if (workableAt(tile)) { socket.emit('world:act', tile); return; }
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
    // The stage is new. Apply whatever the server last said about this place,
    // which may have arrived while the fetch above was in flight, then draw.
    if (latestOccupants) syncOccupants(latestOccupants);
    renderTokens();
  }

  // ---- GM place tool ----
  //
  // Off by default and only offered to a GM. While it is on, clicking a square
  // edits the world instead of walking there, which is why the cursor and the
  // border change: a mode you can forget you are in is a mode that loses work.
  let tool = null;        // null | { mode: 'place'|'remove'|'paint', sprite?, material? }

  function isGm() { return !!window.getLayoutData?.()?.is_dev; }

  function setTool(next) {
    tool = next;
    root?.querySelector('#map-stage')?.classList.toggle('editing', !!tool);
    for (const b of gmPanel?.querySelectorAll('.gm-btn') ?? []) {
      const mode = tool?.tree ? 'tree' : tool?.mode;
      b.classList.toggle('active', !!tool && b.dataset.tool === mode
        && (b.dataset.material ?? null) === (tool.material ?? null));
    }
    const pal = gmPanel?.querySelector('#gm-palette');
    if (pal) pal.hidden = !(tool?.mode === 'place' && !tool.tree);
    if (!tool) updateCursor(null);
    const hint = root?.querySelector('#map-hint');
    if (hint) {
      hint.textContent = tool
        ? (tool.mode === 'place' ? (tool.tree
            ? 'Click a square to grow a tree there.'
            : `Click a square to place ${tool.sprite}.`)
          : tool.mode === 'remove' ? 'Click a square to remove what is on it.'
          : tool.material === 'reset' ? 'Click a square to put its ground back.'
          : `Click a square to paint ${tool.material === 'd' ? 'dirt' : 'grass'}.`)
        : 'Click a square to walk there, or use the arrow keys.';
    }
  }

  /**
   * The square the tool would act on, outlined at the size of what it would put
   * there. A 2x2 building shows its whole footprint, anchored the way it
   * actually lands: on the clicked square, rising into the ones above.
   */
  function updateCursor(tile, mode) {
    const stage = root?.querySelector('#map-stage');
    let el = stage?.querySelector('#map-cursor');
    if (!stage) return;
    if (!tile || (!tool && mode !== 'work')) { el?.remove(); return; }

    if (!el) {
      el = document.createElement('div');
      el.id = 'map-cursor';
      el.className = 'map-cursor';
      stage.appendChild(el);
    }
    let w = 1, h = 1;
    el.classList.toggle('work', mode === 'work');
    if (tool?.mode === 'place' && !tool.tree) {
      const info = catalogue?.sprites?.[tool.sprite];
      if (info) [w, h] = info.size;
    }
    el.classList.toggle('remove', tool?.mode === 'remove');
    el.style.width = `${w * cell}px`;
    el.style.height = `${h * cell}px`;
    el.style.transform = `translate(${tile.x * cell}px, ${(tile.y - (h - 1)) * cell}px)`;
  }

  /**
   * What is standing on a square, whether it grew there or was placed.
   * A tree answers for every square up its trunk, so you can aim at the part
   * you can actually see rather than hunting for its base.
   */
  function propAt(tile) {
    if (!view) return null;
    const dead = new Set(view.obstacles
      .filter(o => o.state === 'destroyed').map(o => `${o.pos.x},${o.pos.y}`));
    for (const o of view.objects) {
      const stack = o.stack ?? [o.sprite];
      if (o.x === tile.x && tile.y > o.y - stack.length && tile.y <= o.y) return stack;
    }
    for (const p of view.terrain.obstacles) {
      if (p.x !== tile.x || tile.y <= p.y - p.stack.length || tile.y > p.y) continue;
      return dead.has(`${p.x},${p.y}`) ? [p.rubble] : p.stack;
    }
    return null;
  }

  const withinReach = (tile) =>
    myTile && Math.max(Math.abs(tile.x - myTile.x), Math.abs(tile.y - myTile.y)) <= 1;

  /** Something to work on, close enough to work on it. */
  function workableAt(tile) {
    if (tool) return false;              // the build tool owns clicks while it is up
    if (!withinReach(tile)) return false;
    const stack = propAt(tile);
    if (!stack) return false;
    const only = stack.length === 1 ? stack[0] : '';
    return stack.length > 1
      || (only.startsWith('dec_tree_'));
  }

  function applyTool(tile) {
    if (!tool || !socket) return false;
    if (tool.mode === 'place')  socket.emit('world:place', { tile, sprite: tool.sprite, kind: tool.tree ? 'tree' : 'decor', rot: rotation, f: flipped });
    else if (tool.mode === 'remove') socket.emit('world:remove', tile);
    else socket.emit('world:paint', { tile, material: tool.material });
    return true;
  }

  // Sprites grouped the way somebody looks for them, rather than as one list of
  // seventy-odd names. Order is the order the tabs appear in.
  // All first, because most of the time you know the thing when you see it and
  // narrowing is the exception. Trees last: the tree tool builds those properly,
  // and these are the loose parts for when you want one particular piece.
  const PALETTE_GROUPS = [
    ['All',        () => true],
    ['Buildings',  (n) => /^bld_/.test(n)],
    ['Camp',       (n) => /^(dec_(log|well|fire|barrel)|obj_chest)/.test(n)],
    ['Plants',     (n) => /^dec_(bush|flower|reed)/.test(n)],
    ['Ground',     (n) => /^(dec_(rock|shell|crab)|ov_)/.test(n)],
    ['Fences',     (n) => /^dec_fence/.test(n)],
    ['Crops',      (n) => /^dec_crop/.test(n)],
    ['Tree parts', (n) => /^dec_tree_/.test(n)],
  ];

  let catalogue = null;
  let activeGroup = 'All';

  function swatchEl(name) {
    const btn = document.createElement('button');
    btn.className = 'gm-swatch';
    btn.type = 'button';
    btn.dataset.sprite = name;
    btn.title = name;
    const canvas = document.createElement('canvas');
    btn.appendChild(canvas);
    // Drawn by the renderer rather than cropped by CSS, so a swatch is exactly
    // what placing it puts on the board, buildings included.
    window.drawSprite?.(canvas, name, 2, rotation, flipped);
    return btn;
  }

  function renderPalette() {
    const grid = gmPanel?.querySelector('#gm-grid');
    if (!grid || !catalogue) return;
    const all = Object.keys(catalogue.sprites);
    let names;
    if (activeGroup === 'All') {
      // Ordered by the tabs themselves, so All reads as the categories run
      // together rather than as one alphabetical jumble. Trees sink to the end
      // with their tab.
      const seen = new Set();
      names = [];
      for (const [label, match] of PALETTE_GROUPS.slice(1)) {
        void label;
        for (const n of all.filter(match).sort()) if (!seen.has(n)) { seen.add(n); names.push(n); }
      }
      for (const n of all.sort()) if (!seen.has(n)) { seen.add(n); names.push(n); }
    } else {
      const group = PALETTE_GROUPS.find(g => g[0] === activeGroup);
      names = all.filter(group[1]).sort();
    }
    grid.innerHTML = '';
    for (const name of names) {
      const sw = swatchEl(name);
      sw.classList.toggle('active', name === selectedSprite);
      sw.addEventListener('click', () => {
        selectedSprite = name;
        for (const o of grid.querySelectorAll('.gm-swatch')) o.classList.toggle('active', o === sw);
        setTool({ mode: 'place', sprite: name });
      });
      grid.appendChild(sw);
    }
  }

  /**
   * The build tool, docked down the left.
   *
   * Its own panel rather than a strip under the board: a sprite list wants
   * height, and a strip gave it a scrolling sliver. Separate from the pause
   * menu too, because that closes when you pick something and this has to stay
   * open while you click the map.
   */
  function renderTools() {
    if (!isGm()) return;
    catalogue = window.spriteCatalogue?.();
    if (!catalogue) return;

    gmPanel = document.createElement('aside');
    gmPanel.id = 'gm-panel';
    gmPanel.hidden = true;
    gmPanel.innerHTML = `
      <div class="gm-modes">
        <button class="gm-btn" type="button" data-tool="off">Walk</button>
        <button class="gm-btn" type="button" data-tool="place">Place</button>
        <button class="gm-btn" type="button" data-tool="tree">Tree</button>
        <button class="gm-btn" type="button" data-tool="remove">Remove</button>
      </div>
      <div class="gm-modes">
        <button class="gm-btn" type="button" id="gm-rotate">Rotate 0&deg; <span class="gm-key">R</span></button>
        <button class="gm-btn" type="button" id="gm-flip">Flip <span class="gm-key">F</span></button>
      </div>
      <div class="gm-modes">
        <button class="gm-btn" type="button" data-tool="paint" data-material="d">Dirt</button>
        <button class="gm-btn" type="button" data-tool="paint" data-material="g">Grass</button>
        <button class="gm-btn" type="button" data-tool="paint" data-material="reset">Reset</button>
      </div>
      <div class="gm-palette" id="gm-palette" hidden>
        <div class="gm-tabs" id="gm-tabs">
          ${PALETTE_GROUPS.map(([label]) =>
            `<button class="gm-tab" type="button" data-group="${label}">${label}</button>`).join('')}
        </div>
        <div class="gm-grid" id="gm-grid"></div>
      </div>`;
    document.body.appendChild(gmPanel);

    gmToggle = document.createElement('button');
    gmToggle.id = 'gm-toggle';
    gmToggle.type = 'button';
    gmToggle.textContent = 'Build';
    gmToggle.addEventListener('click', () => {
      gmPanel.hidden = !gmPanel.hidden;
      gmToggle.classList.toggle('active', !gmPanel.hidden);
      document.body.classList.toggle('gm-open', !gmPanel.hidden);
      if (gmPanel.hidden) setTool(null);
      paint();   // the board's room changed
    });
    document.body.appendChild(gmToggle);

    for (const b of gmPanel.querySelectorAll('.gm-btn')) {
      b.addEventListener('click', () => {
        const mode = b.dataset.tool;
        if (mode === 'off') return setTool(null);
        if (mode === 'paint') return setTool({ mode, material: b.dataset.material });
        if (mode === 'remove') return setTool({ mode });
        // Tree asks the server to run the generator's own rules rather than
        // naming a sprite, so a placed tree is built like a grown one.
        if (mode === 'tree') return setTool({ mode: 'place', sprite: 'tree', tree: true });
        setTool({ mode: 'place', sprite: selectedSprite });
      });
    }
    for (const tab of gmPanel.querySelectorAll('.gm-tab')) {
      tab.classList.toggle('active', tab.dataset.group === activeGroup);
      tab.addEventListener('click', () => {
        activeGroup = tab.dataset.group;
        for (const o of gmPanel.querySelectorAll('.gm-tab')) o.classList.toggle('active', o === tab);
        renderPalette();
      });
    }
    gmPanel.querySelector('#gm-rotate').addEventListener('click', rotateStep);
    gmPanel.querySelector('#gm-flip').addEventListener('click', flipStep);

    // Sheets may still be loading on first mount; swatches are blank until they
    // are, so draw them again when they arrive.
    window.spritesReady?.(() => renderPalette());
    renderPalette();
  }

  function rotateStep() {
    rotation = (rotation + 90) % 360;
    const btn = gmPanel?.querySelector('#gm-rotate');
    if (btn) btn.innerHTML = `Rotate ${rotation}&deg; <span class="gm-key">R</span>`;
    renderPalette();     // the swatches show the turn too
  }

  function flipStep() {
    flipped = !flipped;
    gmPanel?.querySelector('#gm-flip')?.classList.toggle('active', flipped);
    renderPalette();     // the swatches show the mirror too
  }

  function removeTools() {
    gmPanel?.remove(); gmToggle?.remove();
    gmPanel = gmToggle = null;
    document.body.classList.remove('gm-open');
  }

  function connect() {
    socket = io();

    socket.on('connect', () => socket.emit('world:join'));

    socket.on('world:you', async (me) => {
      meId = me.id;
      myTile = me.tile;
      const changed = !myChunk || myChunk.x !== me.chunk.x || myChunk.y !== me.chunk.y;
      myChunk = me.chunk;
      // Nobody from the last place is here. Drop them now rather than letting
      // them be redrawn onto the new stage; the list for this place refills it.
      if (changed) { latestOccupants = null; clearTokens(); }
      // The server decides where you are; the client follows it there.
      if (!view || view.chunk.x !== me.chunk.x || view.chunk.y !== me.chunk.y) {
        await load(me.chunk);
      }
      // Deliberately does NOT ask again: the server broadcasts the occupant
      // list as part of handling world:join, and re-asking from inside the
      // reply is an infinite round trip that floods world:here and snaps every
      // token on each one.
    });

    socket.on('world:here', (data) => {
      // Judged against where the SERVER says we are, not against whatever is
      // currently drawn. During travel the drawn view is still the old place,
      // and comparing against it threw away the list for the new one.
      if (!myChunk || data.chunk.x !== myChunk.x || data.chunk.y !== myChunk.y) return;
      latestOccupants = data.occupants;
      // Held until there is a stage to draw on; load() applies it.
      if (view && view.chunk.x === data.chunk.x && view.chunk.y === data.chunk.y) {
        syncOccupants(latestOccupants);
      }
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

    // An edit landed. Ground is autotiled from shared corners, so a paint
    // changes the ring around the square too and the chunk is refetched;
    // objects are self-contained and can just be added or dropped.
    socket.on('world:changed', async (d) => {
      if (!myChunk || d.chunk.x !== myChunk.x || d.chunk.y !== myChunk.y) return;
      await load(myChunk);
    });

    socket.on('world:placed', (d) => {
      if (!view || d.chunk.x !== view.chunk.x || d.chunk.y !== view.chunk.y) return;
      view.objects.push(d.object);
      paint();
    });

    socket.on('world:removed', (d) => {
      if (!view || d.chunk.x !== view.chunk.x || d.chunk.y !== view.chunk.y) return;
      view.objects = view.objects.filter(o => o.id !== d.id);
      paint();
    });

    // Somebody worked a square. The chunk reload has already been sent; this is
    // just so it reads as somebody doing something rather than terrain blinking.
    socket.on('world:worked', (d) => {
      const note = root?.querySelector('#map-hint');
      if (!note) return;
      note.textContent = d.job === 'chop'
        ? `${d.by} fells a tree.` : `${d.by} clears a stump.`;
      clearTimeout(note._t);
      note._t = setTimeout(() => {
        note.textContent = 'Click a square to walk there, or use the arrow keys.';
      }, 3000);
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

        <p class="map-hint" id="map-hint">Click a square to walk there, or use the arrow keys.</p>
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

    renderTools();

    onResize = () => paint();
    window.addEventListener('resize', onResize);
    bindKeys();
    connect();
  }

  function unmount() {
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = null;
    unbindKeys();
    removeTools();
    myTile = null;
    clearTokens();
    if (socket) { socket.disconnect(); socket = null; }
    meId = null;
    view = null;
    root = null;
  }

  return { mount, unmount };
})();
