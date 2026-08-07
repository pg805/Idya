/* Terrain painter — draws a combat board's ground and props onto a canvas that
 * sits behind the interactive grid.
 *
 * The board itself is still a DOM grid of `.cell` divs (that's what handles
 * clicks, highlights and tokens). This only supplies what those cells sit on
 * top of, in the six passes the art is authored in:
 *
 *   dirt -> grass -> grass overlay -> shadows -> decor -> above decor
 *
 * Everything here lives below the cells in z-order, on purpose. A tree's canopy
 * leans up over the squares above its trunk, and those squares are walkable —
 * so a unit standing "under" a tree, and the move/target highlight on its
 * square, both need to stay readable through the leaves.
 *
 * Sprite coordinates mirror the LAYOUT table in the Asset Library's
 * build-tilesets.lua, which is the source of truth. If a tile moves on the
 * sheet, it moves there first and here second.
 */
(function() {
  const TS = 32;   // source tile size, px

  // ---- atlas ----
  // name -> [sheet, col, row]. 't' = tileset_terrain, 'd' = tileset_decor.
  // The material rows are handled by AUTOTILE below (it needs the whole 6-shape
  // set), so only the standalone terrain entries are named here.
  const ATLAS = {
    shadow_sm: ['t', 0, 8], shadow_md: ['t', 1, 8],
    shadow_lg: ['t', 2, 8], shadow_xl: ['t', 3, 8],

    dec_log_left: ['d', 0, 0], dec_log_center: ['d', 1, 0], dec_log_right: ['d', 2, 0],
    dec_well_01: ['d', 3, 0],
    dec_tree_01_top_01: ['d', 4, 0], dec_tree_01_top_02: ['d', 5, 0],

    dec_bush_01: ['d', 0, 1], dec_bush_02: ['d', 1, 1],
    dec_bush_03: ['d', 2, 1], dec_bush_04: ['d', 3, 1],
    dec_tree_01_middle_01: ['d', 4, 1], dec_tree_01_middle_02: ['d', 5, 1],

    dec_flower_01: ['d', 0, 2], dec_flower_02: ['d', 1, 2],
    dec_grass_01: ['d', 2, 2], dec_grass_02: ['d', 3, 2],
    dec_tree_01_bottom: ['d', 4, 2], dec_barrel_01: ['d', 5, 2],

    dec_reed_01: ['d', 0, 3], dec_rock_01: ['d', 1, 3], dec_rock_02: ['d', 2, 3],
    dec_crab_01: ['d', 3, 3], dec_fire_01: ['d', 4, 3], dec_fire_02: ['d', 5, 3],

    dec_shell_01: ['d', 0, 4], dec_tree_01_stump: ['d', 1, 4],
    ov_grass_01: ['d', 2, 4], ov_grass_02: ['d', 3, 4], ov_grass_03: ['d', 4, 4],
    ov_foam_01: ['d', 5, 4], ov_foam_02: ['d', 0, 5], ov_road_grooves_01: ['d', 1, 5],

    obj_chest_01: ['d', 1, 7],
  };

  // Row of the terrain sheet each material's 6-shape set lives on.
  const MATERIAL_ROW = { grass: 0, dirt: 1, road: 2, stone: 4, sand: 5, water: 6 };

  // ---- dual-grid autotiling ----
  // The 6 terrain shapes cover every way a material can fill the FOUR CORNERS of
  // a tile, once you allow the tile to be rotated. So the drawing grid is offset
  // half a tile from the board grid: each drawn tile straddles the meeting point
  // of four board squares, and which shape it uses depends only on which of
  // those four are the material.
  //
  // Corner bits: NW 8, NE 4, SW 2, SE 1.
  const SHAPE_COL = { full: 0, empty: 1, edge: 2, outer: 3, inner: 4, diagonal: 5 };
  const BASE_MASK = {
    full:     0b1111,   // all four
    empty:    0b0000,
    edge:     0b0101,   // NE + SE — the right half
    outer:    0b0100,   // NE alone
    inner:    0b1101,   // everything but SW
    diagonal: 0b0110,   // NE + SW
  };

  // One 90° clockwise turn sends NW->NE->SE->SW->NW.
  function rotateMask(m) {
    return ((m & 0b1000) >> 1)    // NW -> NE
         | ((m & 0b0100) >> 2)    // NE -> SE
         | ((m & 0b0001) << 1)    // SE -> SW
         | ((m & 0b0010) << 2);   // SW -> NW
  }

  // mask -> { col, rot }. Built once; every one of the 16 masks is reachable.
  const AUTOTILE = (function() {
    const table = new Array(16);
    for (const shape of Object.keys(BASE_MASK)) {
      let m = BASE_MASK[shape];
      for (let rot = 0; rot < 4; rot++) {
        if (table[m] === undefined) table[m] = { col: SHAPE_COL[shape], rot };
        m = rotateMask(m);
      }
    }
    return table;
  })();

  // ---- sheets ----
  const sheets = { t: new Image(), d: new Image() };
  let loaded = 0;
  let ready = false;
  const waiting = [];

  function onSheetLoad() {
    if (++loaded < 2) return;
    ready = true;
    while (waiting.length) waiting.shift()();
  }
  sheets.t.onload = onSheetLoad;
  sheets.d.onload = onSheetLoad;
  sheets.t.src = '/tiles/tileset_terrain.png';
  sheets.d.src = '/tiles/tileset_decor.png';

  // ---- painting ----
  function blit(ctx, sheet, col, row, dx, dy, S) {
    ctx.drawImage(sheets[sheet], col * TS, row * TS, TS, TS, dx, dy, TS * S, TS * S);
  }

  // Props can be drawn mirrored for variety. A horizontal flip is exact under
  // nearest-neighbour, so it costs nothing in sharpness.
  function blitNamed(ctx, name, dx, dy, S, flip) {
    const a = ATLAS[name];
    if (!a) return;
    if (!flip) { blit(ctx, a[0], a[1], a[2], dx, dy, S); return; }
    const size = TS * S;
    ctx.save();
    ctx.translate(dx + size, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sheets[a[0]], a[1] * TS, a[2] * TS, TS, TS, 0, 0, size, size);
    ctx.restore();
  }

  // Rotations are exact multiples of 90°, so nearest-neighbour sampling stays
  // pixel-exact — no smoothing, no half-pixel drift.
  function blitRotated(ctx, sheet, col, row, dx, dy, S, rot) {
    if (rot === 0) { blit(ctx, sheet, col, row, dx, dy, S); return; }
    const half = (TS * S) / 2;
    ctx.save();
    ctx.translate(dx + half, dy + half);
    ctx.rotate((rot * Math.PI) / 2);
    ctx.drawImage(sheets[sheet], col * TS, row * TS, TS, TS, -half, -half, TS * S, TS * S);
    ctx.restore();
  }

  // Paint one material over whatever is already on the canvas, autotiled.
  // `isMat(x, y)` answers "is board square (x,y) this material?", with squares
  // off the board clamped to the nearest edge square so the border reads as the
  // ground continuing rather than as a hard cut.
  function paintMaterial(ctx, material, w, h, isMat, S) {
    const row = MATERIAL_ROW[material];
    const at = (x, y) => isMat(Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y)));
    // (w+1) x (h+1) tiles, each shifted back half a tile.
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const mask = (at(i - 1, j - 1) ? 0b1000 : 0)    // NW
                   | (at(i,     j - 1) ? 0b0100 : 0)    // NE
                   | (at(i - 1, j)     ? 0b0010 : 0)    // SW
                   | (at(i,     j)     ? 0b0001 : 0);   // SE
        if (mask === 0) continue;                        // nothing to draw
        const shape = AUTOTILE[mask];
        blitRotated(ctx, 't', shape.col, row, (i * TS - TS / 2) * S, (j * TS - TS / 2) * S, S, shape.rot);
      }
    }
  }

  function drawGrid(ctx, w, h, S, cellPx) {
    // One CSS pixel's worth of canvas, so the line looks the same weight
    // whatever integer scale the backing store ended up at.
    const lw = Math.max(1, Math.round((TS * S) / cellPx));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    for (let x = 1; x < w; x++) ctx.fillRect(x * TS * S - lw / 2, 0, lw, h * TS * S);
    for (let y = 1; y < h; y++) ctx.fillRect(0, y * TS * S - lw / 2, w * TS * S, lw);
  }

  // Size a canvas so one board square is `cellPx` CSS pixels, and hand back a
  // cleared context. The backing store is an INTEGER multiple of the 32px art,
  // so the art is never resampled at a fractional scale — on a 2x display with
  // 48px squares that works out to an exact 3x. Elsewhere the browser does a
  // final nearest rescale to fit, which pixel art survives far better than a blur.
  function prepare(canvas, w, h, cellPx, S) {
    canvas.width  = w * TS * S;
    canvas.height = h * TS * S;
    canvas.style.width  = `${w * cellPx}px`;
    canvas.style.height = `${h * cellPx}px`;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  // A ring where a unit is, drawn on top of the leaves that hide it. The token
  // itself is a DOM element under the canopy canvas — this is just its outline
  // promoted to the very top so you never lose track of a unit standing in a
  // tree. Matches .combatant's border colours in game.css.
  function drawTokenRing(ctx, unit, isOwn, isSelected, S, cellPx) {
    const cell = TS * S;
    const span = unit.size || 1;
    const lw = Math.max(2, Math.round((2 * cell) / cellPx));
    const cx = (unit.pos.x + span / 2) * cell;
    const cy = (unit.pos.y + span / 2) * cell;
    const r = (cell * span - lw) / 2;

    // Dark ring just outside the coloured one, so it holds up against foliage.
    ctx.lineWidth = lw + Math.max(2, lw);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

    ctx.lineWidth = lw;
    ctx.strokeStyle = isSelected ? '#ffe060' : isOwn ? '#4a90d9' : '#d94a4a';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  /**
   * Paint a board's terrain across two canvases.
   *
   *   canvases.ground  everything up to and including ground-level decor.
   *                    Sits BELOW the grid, so cells stay readable.
   *   canvases.canopy  the above-decor pass — trunks and canopies leaning into
   *                    the squares above. Sits ABOVE the tokens, so a unit
   *                    standing in a tree is genuinely behind the leaves.
   *
   * `opts` carries what the canopy layer needs to stay playable:
   *   combatants     units to ring on top of the leaves
   *   playerTeamId   which of them are yours
   *   selectedKey    'x,y' of the selected unit, or null
   *   highlighted    Set of 'x,y' the player can currently act on
   *   onReady        re-render callback, used if the sheets are still loading
   *
   * Returns false and leaves the canvases alone if there's nothing to draw yet.
   */
  function paintTerrain(canvases, board, cellPx, opts) {
    const terrain = board && board.terrain;
    if (!terrain) return false;
    if (!ready) { waiting.push(opts.onReady); return false; }

    const w = terrain.width, h = terrain.height;
    const dpr = window.devicePixelRatio || 1;
    const S = Math.max(1, Math.round((cellPx * dpr) / TS));
    const px = (n) => n * TS * S;

    const ctx = prepare(canvases.ground, w, h, cellPx, S);

    // 1. dirt — the base everything else sits on, so it's a flat fill.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        blit(ctx, 't', 0, MATERIAL_ROW.dirt, px(x), px(y), S);

    // 2. grass — autotiled on top. Dirt is the rare thing, so what shows through
    // reads as bare earth worn into a forest floor.
    paintMaterial(ctx, 'grass', w, h, (x, y) => terrain.ground[y][x] === 'g', S);

    // 3. grass overlay — tufts that break up the flat fill.
    for (const o of terrain.overlay) blitNamed(ctx, o.s, px(o.x), px(o.y), S, o.f);

    // Obstacles are dressed from live state, not baked: a destroyed one is
    // walkable, so it loses its canopy and its shadow and becomes rubble.
    const state = new Map();
    for (const o of board.obstacles) state.set(`${o.pos.x},${o.pos.y}`, o.state);
    const props = terrain.obstacles.map((p) => {
      const dead = state.get(`${p.x},${p.y}`) === 'destroyed';
      return {
        x: p.x, y: p.y, f: p.f,
        stack: dead ? [p.rubble] : p.stack,
        shadow: dead ? null : p.shadow,
      };
    });

    // 4. shadows — under the props, over the ground.
    for (const p of props) if (p.shadow) blitNamed(ctx, p.shadow, px(p.x), px(p.y), S, false);

    // 5. decor — scatter, then the part of each prop that stands on its square.
    for (const s of terrain.scatter) blitNamed(ctx, s.s, px(s.x), px(s.y), S, s.f);
    for (const p of props) blitNamed(ctx, p.stack[0], px(p.x), px(p.y), S, p.f);

    // Square lines close out the ground layer. This is a tactical grid before
    // it's a landscape — you have to be able to count squares at a glance — but
    // it's kept faint enough to read as ground markings rather than UI chrome.
    drawGrid(ctx, w, h, S, cellPx);

    // 6. above decor, on its own canvas above the tokens.
    const top = prepare(canvases.canopy, w, h, cellPx, S);
    const covered = new Set();
    // Sorted by row so a nearer tree overlaps a farther one, not the reverse.
    for (const p of [...props].sort((a, b) => a.y - b.y)) {
      for (let i = 1; i < p.stack.length; i++) {
        blitNamed(top, p.stack[i], px(p.x), px(p.y - i), S, p.f);
        covered.add(`${p.x},${p.y - i}`);
      }
    }

    // Leaves lose to the UI. Squares the player can act on this turn get the
    // canopy thinned out over them, so a move or target highlight is never
    // buried under a tree it happens to sit beneath.
    const highlighted = opts.highlighted || new Set();
    if (highlighted.size) {
      top.globalCompositeOperation = 'destination-out';
      top.fillStyle = 'rgba(0, 0, 0, 0.72)';
      for (const k of highlighted) {
        const [hx, hy] = k.split(',');
        top.fillRect(px(+hx), px(+hy), TS * S, TS * S);
      }
      top.globalCompositeOperation = 'source-over';
    }

    // Rings last, over everything — but only for units the leaves actually
    // reach. On a clear square the token's own CSS border already does the job
    // and a second circle on top of it would just look doubled.
    for (const unit of opts.combatants || []) {
      const span = unit.size || 1;
      let hidden = false;
      for (let dx = 0; dx < span && !hidden; dx++) {
        for (let dy = 0; dy < span && !hidden; dy++) {
          const k = `${unit.pos.x + dx},${unit.pos.y + dy}`;
          if (covered.has(k) && !highlighted.has(k)) hidden = true;
        }
      }
      if (!hidden) continue;
      const key = `${unit.pos.x},${unit.pos.y}`;
      drawTokenRing(top, unit, unit.teamId === opts.playerTeamId, key === opts.selectedKey, S, cellPx);
    }

    return true;
  }

  window.paintTerrain = paintTerrain;
})();
