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
  /**
   * How long the browser takes to cover the gap between two server frames.
   *
   * ONE number for the tokens, the things in flight, and the camera, and they
   * must agree. The camera used to run on a 130ms leftover from tile-stepping
   * while the tokens ran on 70, and since both chase the same position at
   * different rates, your own token drifted forward as you set off and slid
   * back as you stopped — rubber banding, and only ever on yourself, because
   * only your own token is the one the camera is trying to hold still.
   *
   * Longer than the 50ms tick on purpose: it leaves headroom for a frame that
   * arrives late, which otherwise lets the token reach its target and stop
   * dead until the next one lands. CSS reads it as `--sim-smooth`.
   */
  const SIM_SMOOTH_MS = 70;
  let chunk = { x: 0, y: 0 };
  let view = null;          // the loaded ChunkView
  let root = null;
  let onResize = null;
  let socket = null;
  let meId = null;
  let cell = TILE_SRC;
  const occupants = new Map();   // socket id -> { name, sprite, tile, el }
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
  // The simulation is the source of truth for who is where. Its state arrives
  // ~20x a second and the tokens are driven straight off it, so the old
  // step-and-animate path is no longer what moves anybody.
  const simUnits = new Map();     // id -> { wire, el, bar, box }
  let simState = [];              // the last state, for the attack frame loop
  let attackLoop = null;          // requestAnimationFrame handle
  let simTimer = null;
  let aim = 0;
  /**
   * The attack slot pressed since the last input went out, or null.
   *
   * Slots rather than a flag per button: 0 is left, 1 right, 2 is Q, and the
   * weapon decides what each one does (MELEE in src/combat/melee.ts). A fourth
   * ability is a key here and an entry there.
   */
  let wantSlot = null;
  let mouseTile = null;
  let cameraMs = SIM_SMOOTH_MS;
  // Two keys meant as one diagonal never land in the same event. Waiting this
  // long before the FIRST step lets the second arrive and be counted, which is
  // the difference between going diagonally and going straight and then
  // diagonally. Short enough not to read as input lag next to a 130ms step.
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
  // Where the camera is looking, in tile units. Set from the simulation, so it
  // tracks the body continuously rather than snapping between squares.
  let focus = null;

  function updateCamera(animate) {
    const wrap = root?.querySelector('.map-stage-wrap');
    const stage = root?.querySelector('#map-stage');
    if (!wrap || !stage || !view) return;

    const boardPx = cell * view.size;
    const at = focus ?? (myTile ? { x: myTile.x + 0.5, y: myTile.y + 0.5 } : null);
    const axis = (viewportPx, focusTile) => {
      if (boardPx <= viewportPx) return (viewportPx - boardPx) / 2;   // centre it
      if (at === null) return 0;
      const wanted = focusTile * cell - viewportPx / 2;
      return -Math.max(0, Math.min(wanted, boardPx - viewportPx));
    };

    stage.style.transitionDuration = animate ? `${cameraMs}ms` : '0ms';
    stage.style.transform =
      `translate(${axis(wrap.clientWidth, at?.x ?? 0)}px, ` +
      `${axis(wrap.clientHeight, at?.y ?? 0)}px)`;
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

    // Enemies are on this list too, but they are NOT drawn from it: the
    // simulation broadcasts them live, so drawing them here as well left a
    // second copy standing at the spawn point forever.
    const decor = (view.objects ?? []).filter(o => o.kind !== 'enemy');

    const painted = paintTerrain(
      canvases,
      { terrain: view.terrain, obstacles: view.obstacles, objects: decor },
      cell,
      { onReady: () => paint() },   // sheets may still be loading on first paint
    );

    // One definition of the smoothing, so the camera and what it is following
    // cannot drift apart.
    root.style.setProperty('--sim-smooth', `${SIM_SMOOTH_MS}ms`);

    stage.classList.toggle('loading', !painted);
    root.querySelector('#map-scale').textContent =
      `${view.size}x${view.size} tiles, drawn at ${cell}px`;

    // Tokens follow on the simulation's next frame, which sizes them from the
    // same `cell` the canvases just used.
    placeChestPanel();
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
  /**
   * Record who is here.
   *
   * **This does not draw anybody.** The simulation owns every token: it has the
   * real position twenty times a second, where this list carries the rounded
   * tile from whenever somebody last arrived or left.
   *
   * Drawing from both is what caused the rubber banding. Each player had two
   * tokens — one live and one grid-snapped — and a repaint would put the second
   * back on the server's persisted tile, so a copy of you kept jumping to the
   * middle of a square while the real one walked on. The record is still wanted
   * for the roster and its count; the element is not.
   */
  function ensureToken(id, o) {
    let entry = occupants.get(id);
    if (entry) Object.assign(entry, o);
    else { entry = { ...o }; occupants.set(id, entry); }
    return entry;
  }

  /**
   * Draw the simulation.
   *
   * Tokens are positioned by body centre in tile units, so half a tile of offset
   * puts the sprite over the body rather than beside it. A short linear CSS
   * transition covers the gap between server frames; the server is authoritative
   * and the browser is only smoothing between what it was told.
   */
  function renderSim(units, shots) {
    const layer = tokenLayer();
    if (!layer || !cell) return;
    simState = units;
    startAttackLoop();
    renderShots(layer, shots ?? []);
    const seen = new Set();

    for (const u of units) {
      seen.add(u.id);
      let rec = simUnits.get(u.id);
      if (!rec || !rec.el.isConnected) {
        const el = document.createElement('div');
        el.className = 'map-token sim' + (u.id === meId ? ' me' : '')
          + (u.team === 'enemy' ? ' beast' : '');
        el.innerHTML =
          (u.sprite
            ? `<img class="map-token-sprite" src="${spriteUrl(u.sprite)}" alt="">`
            : '<div class="map-token-blank"></div>')
          + '<span class="map-token-name"></span>'
          + '<span class="sim-hp"><i></i></span>'
          + '<span class="sim-box"></span>'
          + '<img class="sim-weapon" alt="">';
        layer.appendChild(el);
        rec = {
          el,
          name: el.querySelector('.map-token-name'),
          hp: el.querySelector('.sim-hp i'),
          box: el.querySelector('.sim-box'),
          weapon: el.querySelector('.sim-weapon'),
        };
        // A weapon that has not been drawn frame by frame yet still swings; it
        // just swings one picture. Noted so the next frame stops asking.
        rec.weapon.addEventListener('error', () => {
          const name = rec.weaponName;
          if (!name || framelessWeapons.has(name)) return;
          framelessWeapons.add(name);
          rec.weapon.setAttribute('src', spriteUrl(name));
        });
        simUnits.set(u.id, rec);
      }
      rec.el.style.width = `${cell}px`;
      rec.el.style.height = `${cell}px`;
      // Bodies are centred on their coordinate; a token is a tile wide.
      rec.el.style.transform = `translate(${(u.x - 0.5) * cell}px, ${(u.y - 0.9) * cell}px)`;
      if (rec.name.textContent !== u.name) rec.name.textContent = u.team === 'enemy' ? '' : u.name;
      rec.hp.style.width = `${Math.max(0, 100 * u.hp / u.maxHp)}%`;
      rec.el.classList.toggle('hurt', u.hp < u.maxHp);

      // The attack is NOT drawn here. It runs on its own frame loop below, so
      // the swing animates at the browser's rate instead of the server's 20.
      if (u.id === meId) {
        myTile = { x: Math.floor(u.x), y: Math.floor(u.y) };
        focus = { x: u.x, y: u.y };
        updateCamera(true);
      }
    }

    for (const [id, rec] of simUnits) {
      if (seen.has(id)) continue;
      rec.el.remove();
      simUnits.delete(id);
    }
  }

  /**
   * Things in flight.
   *
   * Pooled by index rather than keyed by id: a shot has no identity worth
   * tracking, there are never many, and the server sends the whole list every
   * frame. Drawn with the same 70ms smoothing as a body so it does not stutter
   * between frames.
   */
  const shotEls = [];

  function renderShots(layer, shots) {
    for (let i = 0; i < shots.length; i++) {
      let el = shotEls[i];
      if (!el || !el.isConnected) {
        el = document.createElement('img');
        el.className = 'sim-shot';
        el.alt = '';
        layer.appendChild(el);
        shotEls[i] = el;
      }
      const sh = shots[i];
      const src = sh.sprite ? spriteUrl(sh.sprite) : null;
      if (src && el.getAttribute('src') !== src) el.setAttribute('src', src);
      el.hidden = !src;
      el.style.width = `${cell}px`;
      el.style.height = `${cell}px`;
      // Centred on the shot, then turned so the sprite's up points the way it
      // is travelling — the same quarter turn a held weapon gets.
      el.style.transform = `translate(${(sh.x - 0.5) * cell}px, ${(sh.y - 0.5) * cell}px)`
        + ` rotate(${sh.aim}rad) rotate(90deg)`;
    }
    for (let i = shots.length; i < shotEls.length; i++) {
      if (shotEls[i]) { shotEls[i].remove(); shotEls[i] = null; }
    }
    shotEls.length = shots.length;
  }

  /**
   * The swing, on its own clock.
   *
   * Driven by the `swing` and `tell` EVENTS rather than the phase field in each
   * snapshot, for three reasons that all bite at once.
   *
   * A 250ms window is five server ticks, and the phase field is only sampled on
   * four of them: the fifth sets itself idle before the state goes out, while
   * still running its hit check, so a blow could land from a sword that was
   * never drawn. An event plus a duration covers the whole window.
   *
   * Five frames across four samples cannot be animated at all. On a clock the
   * animation runs at the browser's frame rate and its length comes from the
   * shape, so a heavier weapon animates longer without anyone restating it.
   *
   * The phase field is still consulted as a backstop: joining mid-swing, or
   * losing the event, leaves the clock empty and the snapshot is all there is.
   */

  /**
   * Out and back: 1..n, then back down to 1.
   *
   * The tip, more of it, the whole weapon, then the way it came — the retreat
   * reads as the hand pulling in. Three drawings give five steps, which is the
   * sword; five would give nine.
   *
   * The count arrives with the swing event, so a new melee weapon needs nothing
   * in this file: it is an entry in MELEE in src/combat/melee.ts plus the
   * drawings. This mirrors swingSequence() there, which is the definition and
   * is the one with tests on it; the browser cannot import TypeScript.
   */
  const swingSequence = (frames, spread) => {
    const n = (Number.isInteger(frames) && frames > 0) ? frames : 0;
    if (n === 0) return [0];                 // 0 means the base sprite alone
    const seq = [];
    for (let i = 1; i <= n; i++) seq.push(i);
    // A swept swing runs once: its angle is the animation, and retracing would
    // walk the blade back along its own arc.
    if (!spread) for (let i = n - 1; i >= 1; i--) seq.push(i);
    return seq;
  };

  /** Built once per shape of swing rather than per frame. */
  const frameSequences = new Map();
  function sequenceFor(frames, spread) {
    const key = `${frames}|${spread ? 1 : 0}`;
    let seq = frameSequences.get(key);
    if (!seq) { seq = swingSequence(frames, spread); frameSequences.set(key, seq); }
    return seq;
  }

  /**
   * Where a swing points when it is `progress` of the way through.
   *
   * Mirrors swingAngle() in src/combat/realtime.ts, which is the definition and
   * has the tests. A thrust holds its committed angle; a swept swing turns
   * through its spread, and aimAt says where along that turn the aimed
   * direction falls — the middle for a short arc, the start for a full circle.
   */
  function swingAngleAt(committed, spread, progress, aimAt) {
    if (!spread) return committed;
    const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    const at = typeof aimAt === 'number' ? aimAt : 0.5;
    return committed - spread * at + spread * p;
  }

  /** Weapons whose numbered frames 404; they fall back to the single sprite. */
  const framelessWeapons = new Set();

  function weaponFrameUrl(weapon, n) {
    if (framelessWeapons.has(weapon)) return spriteUrl(weapon);
    return spriteUrl(`${weapon}_${n}`);
  }

  /** Clocks started by events, keyed by unit: when it began and how long. */
  const swingClocks = new Map();
  const tellClocks = new Map();

  function noteSwing(id, ms, frames, aim, spread, aimAt, isShot) {
    swingClocks.set(id, {
      start: performance.now(), ms: ms || 1,
      seq: sequenceFor(frames, spread), aim, spread: spread || 0, aimAt, isShot,
    });
    tellClocks.delete(id);
  }
  function noteTell(id, ms) {
    tellClocks.set(id, { start: performance.now(), ms: ms || 1 });
  }

  /** How far through a clock, or null when it has run out or never started. */
  function clockAt(clocks, id, now) {
    const c = clocks.get(id);
    if (!c) return null;
    const t = (now - c.start) / c.ms;
    if (t >= 1) { clocks.delete(id); return null; }
    return t < 0 ? 0 : t;
  }

  function paintAttacks(now) {
    if (!cell) return;
    for (const u of simState) {
      const rec = simUnits.get(u.id);
      if (!rec) continue;

      const swing = swingClocks.get(u.id);
      const swingT = clockAt(swingClocks, u.id, now);
      const tellT = clockAt(tellClocks, u.id, now);
      // The snapshot is the backstop for a clock that never started.
      const live = swingT !== null || u.phase === 'active';
      const tell = swingT === null && (tellT !== null || u.phase === 'tell');
      // A shot is already drawn as the thing in flight, so the held weapon
      // stays down: otherwise firing drew a sword at the body AND threw one.
      // The phase backstop below cannot tell a shot from a swing, so a lost
      // event can still flash one for a window; cosmetic, and it needs a
      // release pose drawn before it is worth a field on every state frame.
      const swings = live && !!u.weapon && !swing?.isShot;
      const radius = u.r ?? 0.34;
      // Where the blade is now. A thrust holds the angle it committed to; an
      // arc has turned part of the way through its spread, which is the same
      // rule the hitbox uses, so the drawing cannot drift off what it hits.
      // Falls back to the live facing for a wind-up, which is still being
      // aimed, and to the state's committed angle if the event was missed.
      const committed = swing?.aim ?? (u.swingAim != null ? u.swingAim : u.aim);
      const angle = live
        ? swingAngleAt(committed, swing?.spread ?? 0, swingT ?? 1, swing?.aimAt)
        : u.aim;

      rec.box.hidden = !((live && !u.weapon) || tell);
      if (!rec.box.hidden) {
        // The swept length, matching sweptLength() in src/combat/realtime.ts:
        // reach is measured from the body's EDGE, so the rectangle the engine
        // tests is the radius plus the reach. A box drawn to reach alone was
        // short by a radius and told the player they had less range than they
        // do, which for an enemy telegraph is the wrong way to be wrong.
        const along = (radius + u.reach) * cell, across = u.width * cell;
        rec.box.className = 'sim-box ' + (live ? 'live' : 'tell');
        rec.box.style.width = `${along}px`;
        rec.box.style.height = `${across}px`;
        // Centre the sweep on the body. This was a flat -1px, which left the
        // rectangle sitting half its own height low.
        rec.box.style.marginTop = `${-across / 2}px`;
        rec.box.style.transform = `rotate(${angle}rad)`;
      }

      rec.weapon.hidden = !swings;
      if (swings) {
        // Without a clock there is no progress to read, so hold the weapon
        // fully extended rather than guessing at a frame.
        const seq = swing?.seq ?? sequenceFor(3, 0);
        const step = swingT === null
          ? seq.length - 1
          : Math.min(seq.length - 1, Math.floor(swingT * seq.length));
        const frame = seq[step];
        if (rec.frame !== frame || rec.weaponName !== u.weapon) {
          rec.frame = frame;
          rec.weaponName = u.weapon;
          // Frame 0 is the base sprite: a swing with no numbered drawings,
          // which is what a turning blade wants since it is out the whole way.
          rec.weapon.setAttribute('src',
            frame === 0 ? spriteUrl(u.weapon) : weaponFrameUrl(u.weapon, frame));
        }

        const len = u.reach * cell;
        const grip = radius * cell;
        rec.weapon.style.width = `${len}px`;
        rec.weapon.style.height = `${len}px`;
        rec.weapon.style.marginLeft = `${-len / 2}px`;
        rec.weapon.style.marginTop = `${-len / 2}px`;
        // Read left to right, each step in the frame the last one left: turn to
        // the aim, push out far enough that the GRIP sits on the body's edge
        // rather than at its centre, then turn the sprite itself, which is
        // drawn pointing up, a quarter so its up becomes the aim.
        //
        // The push is the body radius plus half the sword, which puts the grip
        // a radius out and the blade beyond it. Pinned at the centre the sword
        // pivoted about one spot like a clock hand and read as lying on the
        // floor; held at the edge it orbits the body the way an arm carries it.
        // Grip at `radius`, tip at radius + reach, which is sweptLength() in
        // src/combat/realtime.ts, so both ends sit on the real hitbox.
        rec.weapon.style.transform =
          `rotate(${angle}rad) translateX(${grip + len / 2}px) rotate(90deg)`;
      } else if (rec.frame !== undefined) {
        rec.frame = undefined;          // so the next swing starts at frame 1
      }
    }
  }

  function startAttackLoop() {
    if (attackLoop !== null) return;
    const step = (now) => {
      if (!tokenLayer()) { attackLoop = null; return; }
      paintAttacks(now);
      attackLoop = requestAnimationFrame(step);
    };
    attackLoop = requestAnimationFrame(step);
  }

  /**
   * Nothing to redraw: the simulation's next frame paints everybody.
   *
   * Kept as a name because travelling and repainting both used to call it, and
   * a no-op reads better at those call sites than their having to know that
   * tokens are somebody else's business now.
   */
  function renderTokens() {}

  function spriteUrl(token) {
    const cdn = window.getLayoutData?.()?.spriteCdn;
    return cdn ? `${cdn}/${token}.png` : `/sprites/${token}.png`;
  }

  /**
   * The camera rides with you.
   *
   * Called from the simulation's frame now that nothing walks tile by tile.
   */

  // ---- keyboard ----

  /** The combined direction of everything held. Opposites cancel. */
  function currentDir() {
    let dx = 0, dy = 0;
    for (const d of heldKeys.values()) { dx += d.dx; dy += d.dy; }
    return { dx: Math.sign(dx), dy: Math.sign(dy) };
  }

  /**
   * Push our intent at the server.
   *
   * Direction and aim, not position. The server decides where that puts us, so
   * nothing here has to be trusted. Attack is a one-shot flag: it is cleared as
   * soon as it has been sent, and the server holds it until the cooldown allows
   * it, which is what stops a press from being swallowed.
   */
  function sendInput() {
    if (!socket || !myChunk) return;
    let dx = 0, dy = 0;
    for (const d of heldKeys.values()) { dx += d.dx; dy += d.dy; }
    socket.emit('sim:input', {
      moveX: Math.sign(dx), moveY: Math.sign(dy),
      aim, swing: wantSlot,
    });
    wantSlot = null;
  }

  function startInput() {
    if (!simTimer) simTimer = setInterval(sendInput, 50);
  }


  /**
   * Holding a key is now just a fact about the input we are already sending.
   *
   * There is nothing to schedule: sendInput runs on its own clock and reads
   * whatever is held at the time. The diagonal grace window is gone with it —
   * it existed so a diagonal could form before the first tile step fired, and
   * there are no tile steps.
   */
  function beginHold(key, dir) {
    heldKeys.set(key, dir);
  }

  function releaseHold(key) {
    heldKeys.delete(key);
    if (heldKeys.size === 0) endHold();
  }

  function endHold() {
    heldKeys.clear();
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
      // Q is slot 2 and E is slot 3. Not movement keys and not taken by a
      // tool, and the free keys beside WASD are the ones Controls reserves
      // for abilities.
      if ((e.key === 'q' || e.key === 'Q') && !tool) {
        e.preventDefault();
        wantSlot = 2;
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && !tool) {
        e.preventDefault();
        wantSlot = 3;
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

    }
    for (const id of [...occupants.keys()]) {
      if (!seen.has(id)) occupants.delete(id);
    }
    const count = occupants.size;
    const here = root?.querySelector('#map-here');
    if (here) here.textContent = count === 1 ? 'Just you here.' : `${count} here.`;
  }

  function clearSim() {
    for (const rec of simUnits.values()) rec.el.remove();
    simUnits.clear();
  }

  function clearTokens() {
    clearSim();
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

    // The mouse points; it does not move you. Aim is a real angle from the body
    // to the cursor, so there is no direction to round off.
    stage.addEventListener('mousemove', (e) => {
      const r = stage.getBoundingClientRect();
      mouseTile = {
        x: (e.clientX - r.left) / cell,
        y: (e.clientY - r.top) / cell,
      };
      if (focus) aim = Math.atan2(mouseTile.y - focus.y, mouseTile.x - focus.x);
    });

    stage.addEventListener('mousedown', (e) => {
      // Left is slot 0, right is slot 1. Right is where the shield is meant to
      // go (docs/combat.md, Controls); it is on a swing for now so there is
      // something to throw while the feel is being judged.
      if (e.button !== 0 && e.button !== 2) return;
      if (tool) return;                       // the build tool owns clicks while up
      const r = stage.getBoundingClientRect();
      const t = {
        x: Math.floor((e.clientX - r.left) / cell),
        y: Math.floor((e.clientY - r.top) / cell),
      };
      if (workableAt(t)) return;              // working the land, handled on click
      wantSlot = e.button === 2 ? 1 : 0;
    });

    // Otherwise the right button opens the browser's menu over the fight.
    stage.addEventListener('contextmenu', (e) => {
      if (tool) return;                       // the build tool may want it
      e.preventDefault();
    });

    stage.addEventListener('click', (e) => {
      if (!socket || !view) return;
      const r = stage.getBoundingClientRect();
      const tile = {
        x: Math.floor((e.clientX - r.left) / cell),
        y: Math.floor((e.clientY - r.top) / cell),
      };
      if (tile.x < 0 || tile.y < 0 || tile.x >= view.size || tile.y >= view.size) return;
      if (applyTool(tile)) return;
      // Clicking works the land, opens what can be opened, and drives the GM
      // tools. It does NOT move you: movement is WASD everywhere, the same as
      // in combat, and the mouse is for pointing at things.
      const chest = chestAt(tile);
      if (chest) { void openChest(chest.id, { x: chest.x, y: chest.y }); return; }
      if (workableAt(tile)) { socket.emit('world:act', tile); return; }
    });

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
        : '';
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
      if (o.kind === 'enemy') continue;      // a bird is not a prop to work on
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

  /** The chest on a square, if there is one and you can reach it. */
  function chestAt(tile) {
    if (!view || tool || !withinReach(tile)) return null;
    return (view.objects ?? []).find(o =>
      o.x === tile.x && o.y === tile.y && /^obj_chest/.test(o.sprite)) ?? null;
  }

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
      <div class="gm-modes">
        <button class="gm-btn" type="button" id="gm-seed">Seed swallows</button>
        <button class="gm-btn" type="button" id="gm-unseed">Clear enemies</button>
      </div>
      <p class="gm-note" id="gm-note"></p>
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

    // Seeding lives here rather than in a console: it is world editing, and this
    // is where world editing is. Says what it did, so an empty chunk is a fact
    // rather than a guess.
    const gmNote = (text) => {
      const n = gmPanel.querySelector('#gm-note');
      if (n) n.textContent = text;
    };
    gmPanel.querySelector('#gm-seed').addEventListener('click', async () => {
      gmNote('Seeding…');
      try {
        const r = await fetch('/api/dev/seed-swallows?per=3', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) { gmNote(d.error ?? `Failed (${r.status})`); return; }
        gmNote(`Placed ${d.placed} across ${d.chunks} chunk(s)`
          + (d.skipped?.length ? `, skipped ${d.skipped.length} that already had some.` : '.'));
        if (view) await load(view.chunk);
      } catch (err) { gmNote(`Failed: ${err}`); }
    });
    gmPanel.querySelector('#gm-unseed').addEventListener('click', async () => {
      gmNote('Clearing…');
      try {
        const r = await fetch('/api/dev/clear-enemies', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) { gmNote(d.error ?? `Failed (${r.status})`); return; }
        gmNote(`Removed ${d.removed}.`);
        if (view) await load(view.chunk);
      } catch (err) { gmNote(`Failed: ${err}`); }
    });

    for (const b of gmPanel.querySelectorAll('.gm-btn')) {
      if (b.id === 'gm-seed' || b.id === 'gm-unseed') continue;   // not tools
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
    socket = window.gameSocket();

    if (socket.connected) socket.emit('world:join');
    socket.on('connect', () => socket.emit('world:join'));

    socket.on('world:you', async (me) => {
      meId = me.id;
      myTile = me.tile;
      focus = { x: me.tile.x + 0.5, y: me.tile.y + 0.5 };
      startInput();
      const changed = !myChunk || myChunk.x !== me.chunk.x || myChunk.y !== me.chunk.y;
      myChunk = me.chunk;
      // Nobody from the last place is here. Drop them now rather than letting
      // them be redrawn onto the new stage; the list for this place refills it.
      if (changed) { latestOccupants = null; clearTokens(); closeChest(); }
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
      // Movement comes from sim:state. Nothing to do with a walk any more; the
      // handler stays only so a server still sending them does not reach a
      // client with no listener.
    });

    // A step that ran into something. Nothing moves; we just stop pressing.
    // The simulation, ~20x a second. This is what moves everybody now, so the
    // old occupant tokens are taken down the first time it arrives rather than
    // drawing two of each person.
    socket.on('sim:state', ({ units, shots }) => {
      if (occupants.size) for (const o of occupants.values()) { o.el?.remove(); o.el = null; }
      renderSim(units ?? [], shots ?? []);
      if (chestId && !chestStillInReach()) closeChest();
    });

    socket.on('sim:events', ({ events }) => {
      for (const ev of events ?? []) {
        // A swing and a wind-up each start a clock, which is what the attack
        // frame loop animates from. The duration rides along on the shape, so
        // a weapon's own timing drives its animation.
        if (ev.kind === 'swing') {
          noteSwing(ev.by, ev.shape?.activeMs, ev.frames, ev.aim,
            ev.shape?.spread, ev.shape?.aimAt, !!ev.shape?.shot);
          continue;
        }
        if (ev.kind === 'tell') { noteTell(ev.by, ev.shape?.tellMs); continue; }
        if (ev.kind !== 'hit') continue;
        const rec = simUnits.get(ev.on);
        if (!rec) continue;
        rec.el.classList.remove('struck');
        void rec.el.offsetWidth;              // restart the flash
        rec.el.classList.add('struck');
      }
    });

    // Somebody moved something in a chest. If it is the one we have open, the
    // contents arrive with the message, so the grid changes in the same instant
    // rather than a refetch later. Silently, and with no distinction between
    // our move and theirs: the whole point is that both panels show the same
    // thing, and a chest that quietly agrees with itself needs no announcing.
    socket.on('chest:changed', ({ chest }) => {
      if (!chestId || !chest || chest.id !== chestId) return;
      const el = document.getElementById('chest-panel');
      if (!el || el.hidden) return;
      drawChest(chest, lastBag);
    });

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
        note.textContent = '';
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

  // ---- chests ----
  // Two rows of six. Clicking a chest slot takes the stack; clicking a bag row
  // deposits it. No dragging: one click per move is less to build and less to
  // explain, and the server is what decides whether a move is allowed anyway.

  let chestId = null;
  let lastBag = [];         // the bag as last drawn; a broadcast only carries the chest
  let chestTile = null;      // where the thing we opened is standing
  let chestPoll = null;      // slow re-read, so a dropped broadcast self-heals
  /** Give up on a chest past this, in tiles. Reach is 1; this is 1 plus slack. */
  const CHEST_RANGE = 2.2;

  function chestPanel() {
    let el = document.getElementById('chest-panel');
    if (el?.isConnected) return el;
    // Inside the stage rather than fixed to the viewport: the chat is a real
    // column, not an overlay, so anything pinned to the corner sits on top of
    // it. On the stage it also rides the camera, which reads as the chest's own
    // drawer rather than a dialog about a chest.
    const stage = root?.querySelector('#map-stage');
    el = document.createElement('aside');
    el.id = 'chest-panel';
    el.hidden = true;
    el.innerHTML = `
      <header>
        <h3>Chest</h3>
        <button type="button" id="chest-close" aria-label="Close">&times;</button>
      </header>
      <div class="chest-grid" id="chest-grid"></div>
      <p class="chest-note" id="chest-note"></p>
      <h4>Carrying</h4>
      <div class="chest-grid" id="chest-bag"></div>`;
    (stage ?? document.body).appendChild(el);
    el.querySelector('#chest-close').addEventListener('click', closeChest);
    return el;
  }

  /**
   * Put the panel beside the chest, kept inside the board.
   *
   * Offset to the right and up so it does not cover the chest itself, then
   * clamped, because a chest near an edge would otherwise hang off it.
   */
  function placeChestPanel() {
    const el = document.getElementById('chest-panel');
    if (!el || el.hidden || !chestTile || !view || !cell) return;
    const boardPx = cell * view.size;
    const w = el.offsetWidth || 260;
    const h = el.offsetHeight || 220;
    const x = Math.min(Math.max(0, (chestTile.x + 1) * cell), Math.max(0, boardPx - w));
    const y = Math.min(Math.max(0, (chestTile.y - 1) * cell), Math.max(0, boardPx - h));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function closeChest() {
    stopChestPoll();
    chestId = null;
    chestTile = null;
    const el = document.getElementById('chest-panel');
    if (el) el.hidden = true;
  }

  /** Walked away from what you opened. Reach is enforced server-side regardless. */
  function chestStillInReach() {
    if (!chestTile || !focus) return true;
    return Math.hypot(focus.x - (chestTile.x + 0.5), focus.y - (chestTile.y + 0.5)) <= CHEST_RANGE;
  }

  async function openChest(id, tile) {
    chestId = id;
    chestTile = tile;
    const el = chestPanel();
    el.hidden = false;
    placeChestPanel();
    el.querySelector('#chest-note').textContent = 'Opening…';
    startChestPoll();
    await refreshChest();
  }

  /**
   * Re-read the chest from the server.
   *
   * `keepNote` leaves an error message in place, so a refusal can explain itself
   * and correct the grid in the same breath.
   */
  async function refreshChest(keepNote) {
    if (!chestId) return;
    const el = chestPanel();
    const note = el.querySelector('#chest-note');
    try {
      const r = await fetch(`/api/chest?id=${encodeURIComponent(chestId)}`);
      const d = await r.json();
      if (!r.ok) { note.textContent = d.error ?? 'Cannot open that.'; return; }
      if (!keepNote) note.textContent = '';
      drawChest(d.chest, d.inventory ?? []);
      placeChestPanel();
    } catch (err) {
      note.textContent = `Cannot open that: ${err}`;
    }
  }

  /**
   * A slow re-read while the panel is open.
   *
   * The broadcast is what makes a change instant, but it is one message over one
   * socket and a dropped one leaves a slot on screen that is not in the chest.
   * Two seconds is slow enough to cost nothing and fast enough that a phantom
   * cannot survive long enough to be worth a bug report. Correctness does not
   * depend on the push arriving.
   */
  function startChestPoll() {
    stopChestPoll();
    chestPoll = setInterval(() => {
      if (!chestId) { stopChestPoll(); return; }
      void refreshChest(true);
    }, 2000);
  }
  function stopChestPoll() {
    if (chestPoll) { clearInterval(chestPoll); chestPoll = null; }
  }

  /**
   * An item's icon, falling back to the checkerboard.
   *
   * No registry: the file is named for the item id, so making
   * public/items/sulwood.png is the whole of adding its icon. Anything unmade
   * shows _missing.png, which is magenta on purpose.
   */
  function itemIcon(itemId) {
    return `<img class="slot-icon" src="/items/${encodeURIComponent(itemId)}.png" alt=""`
      + ` onerror="this.onerror=null;this.src='/items/_missing.png'">`;
  }

  /**
   * One slot, filled or empty.
   *
   * Both halves of the panel use this, so a thing in your hands and the same
   * thing in the chest are the same square. A list on one side and a grid on the
   * other made moving something read as a conversion rather than a move.
   */
  function slotCell(entry, title, onClick) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'chest-slot' + (entry ? ' filled' : '');
    cell.disabled = !entry;
    if (!entry) return cell;
    cell.innerHTML = itemIcon(entry.itemId)
      + (entry.quantity > 1 ? `<span class="chest-qty">${entry.quantity}</span>` : '');
    cell.title = title;
    cell.addEventListener('click', onClick);
    return cell;
  }

  function drawChest(chest, bag) {
    lastBag = bag ?? lastBag;
    bag = lastBag;
    const el = chestPanel();
    const grid = el.querySelector('#chest-grid');
    const bySlot = new Map((chest.slots ?? []).map(sl => [sl.slot, sl]));
    grid.style.setProperty('--chest-cols', chest.cols ?? 6);
    grid.innerHTML = '';
    for (let i = 0; i < (chest.size ?? 12); i++) {
      const sl = bySlot.get(i);
      grid.appendChild(slotCell(
        sl,
        sl ? `Take ${sl.quantity} ${sl.name}` : '',
        () => void moveChest('take', { slot: i }),
      ));
    }

    // The bag is the same grid, padded to a full row or two so it reads as a
    // container rather than a ragged edge of however much you happen to carry.
    const bagEl = el.querySelector('#chest-bag');
    const cols = chest.cols ?? 6;
    bagEl.style.setProperty('--chest-cols', cols);
    bagEl.innerHTML = '';
    const shown = Math.max(cols, Math.ceil(bag.length / cols) * cols);
    for (let i = 0; i < shown; i++) {
      const row = bag[i];
      bagEl.appendChild(slotCell(
        row,
        row ? `Put ${row.quantity} ${row.name} in` : '',
        () => void moveChest('put', { itemId: row.itemId }),
      ));
    }
  }

  async function moveChest(verb, body) {
    if (!chestId) return;
    const note = chestPanel().querySelector('#chest-note');
    try {
      const r = await fetch(`/api/chest/${verb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: chestId, ...body }),
      });
      const d = await r.json();
      if (!r.ok) {
        note.textContent = d.error ?? 'That did not work.';
        // A refusal means the panel was showing something that is not there —
        // a slot somebody else already emptied. Re-read so clicking a phantom
        // heals it rather than leaving it on screen to be clicked again.
        await refreshChest(true);
        return;
      }
      note.textContent = '';
      await refreshChest();
    } catch (err) {
      note.textContent = `That did not work: ${err}`;
    }
  }

  function mount(el) {
    root = el;
    root.innerHTML = `
      <div class="map-view">
        <p class="map-hint" id="map-hint"></p>
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
    // The socket is shared with the chat beside it, so it is not ours to close.
    socket = null;
    meId = null;
    view = null;
    root = null;
  }

  return { mount, unmount };
})();
