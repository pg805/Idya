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
  // Regenerated from build-tilesets.lua in the Asset Library, which is the
  // source of truth for where every sprite sits. The sheet gets reorganised as
  // it grows, so hand-editing coordinates here goes wrong quietly: a stale entry
  // still draws, it just draws the wrong tile.
  //
  // Buildings are included, and SPRITE_SIZE below says how many cells each one
  // spreads across. Their atlas entry is the TOP-LEFT cell; the sprite runs
  // right and down from there.
  const ATLAS = {
    // shadows
    shadow_sm: ['t', 0, 8], shadow_md: ['t', 1, 8],
    shadow_lg: ['t', 2, 8], shadow_xl: ['t', 3, 8],

    // tree 01
    dec_tree_01_top_01: ['d', 0, 0], dec_tree_01_top_02: ['d', 1, 0],
    dec_tree_01_top_03: ['d', 2, 0], dec_tree_01_top_04: ['d', 3, 0],
    dec_tree_01_top_05: ['d', 4, 0], dec_tree_01_top_06: ['d', 5, 0],
    dec_tree_01_middle_01: ['d', 0, 1], dec_tree_01_top_07: ['d', 1, 1],
    dec_tree_01_middle_02: ['d', 2, 1], dec_tree_01_stump: ['d', 3, 1],
    dec_tree_01_bottom: ['d', 0, 2],

    // tree 02
    dec_tree_02_top_01: ['d', 0, 3], dec_tree_02_top_03: ['d', 1, 3],
    dec_tree_02_top_04: ['d', 2, 3], dec_tree_02_top_05: ['d', 3, 3],
    dec_tree_02_top_06: ['d', 4, 3], dec_tree_02_top_07: ['d', 5, 3],
    dec_tree_02_middle_03: ['d', 0, 4], dec_tree_02_middle_02: ['d', 0, 5],
    dec_tree_02_middle_01: ['d', 0, 6], dec_tree_02_bottom: ['d', 0, 7],
    dec_tree_02_stump: ['d', 1, 7],

    // plants
    dec_bush_01: ['d', 4, 1], dec_bush_02: ['d', 5, 1],
    dec_bush_03: ['d', 1, 2], dec_bush_04: ['d', 2, 2],
    dec_flower_01: ['d', 3, 2], dec_flower_02: ['d', 4, 2],
    dec_reed_01: ['d', 5, 2],

    // scatter
    dec_rock_01: ['d', 1, 4], dec_rock_02: ['d', 2, 4],
    dec_shell_01: ['d', 3, 4], dec_crab_01: ['d', 4, 4],

    // camp
    dec_log_left: ['d', 2, 5], dec_log_center: ['d', 3, 5],
    dec_log_right: ['d', 4, 5], dec_well_01: ['d', 5, 5],
    dec_fire_01: ['d', 1, 6], dec_fire_02: ['d', 2, 6],

    // containers
    dec_barrel_01: ['d', 5, 4], obj_chest_01: ['d', 1, 5],

    // overlays
    ov_grass_01: ['d', 3, 6], ov_grass_02: ['d', 4, 6],
    ov_grass_03: ['d', 5, 6], ov_foam_01: ['d', 2, 7],
    ov_foam_02: ['d', 3, 7], ov_road_grooves_01: ['d', 4, 7],

    // fences
    dec_fence_post: ['d', 5, 7], dec_fence_end: ['d', 0, 8],
    dec_fence_straight: ['d', 1, 8], dec_fence_turn: ['d', 2, 8],
    dec_fence_t_junction: ['d', 3, 8], dec_fence_cross: ['d', 4, 8],
    dec_fence_gate: ['d', 5, 8],

    // buildings — atlas entry is the top-left cell; see SPRITE_SIZE
    bld_house_01: ['d', 0, 11], bld_shed_01: ['d', 2, 11],
    bld_smithy_01: ['d', 3, 11], bld_house_02: ['d', 0, 13],
    bld_house_back_02: ['d', 2, 13], bld_tent_01: ['d', 4, 13],
    bld_tent_02: ['d', 0, 15], bld_tent_03: ['d', 2, 15],
    bld_tent_04: ['d', 4, 15],

    // crops
    dec_crop_grain_sprout_01: ['d', 0, 9], dec_crop_grain_growth_01: ['d', 1, 9],
    dec_crop_grain_harvest_01: ['d', 2, 9], dec_crop_root_sprout_01: ['d', 3, 9],
    dec_crop_root_growth_01: ['d', 4, 9], dec_crop_root_harvest_01: ['d', 5, 9],
    dec_crop_legume_sprout_01: ['d', 0, 10], dec_crop_legume_growth_01: ['d', 1, 10],
    dec_crop_legume_harvest_01: ['d', 2, 10],
  };

  // Anything not listed is a single cell. Buildings are two rows tall and,
  // except the shed, two columns wide.
  const SPRITE_SIZE = {
    bld_house_01: [2, 2], bld_shed_01: [1, 2], bld_smithy_01: [2, 2],
    bld_house_02: [2, 2], bld_house_back_02: [2, 2],
    bld_tent_01: [2, 2], bld_tent_02: [2, 2],
    bld_tent_03: [2, 2], bld_tent_04: [2, 2],
  };
  const sizeOf = (name) => SPRITE_SIZE[name] || [1, 1];

  // ---- shadows ----
  // Each shadow sprite is drawn to fit a particular piece of decor, so which one
  // a square gets follows from the sprite standing on it. That's why the shadow
  // pass runs after every prop is placed rather than being decided upstream.
  // A stump is a felled tree, so it's the same girth as one and takes the same
  // shadow. Pebbles get none at all — they sit flat on the ground.
  const SHADOW_FOR = {
    dec_tree_01_bottom: 'shadow_xl',
    dec_tree_01_stump:  'shadow_xl',
    dec_tree_02_bottom: 'shadow_xl',
    dec_tree_02_stump:  'shadow_xl',
    dec_bush_01: 'shadow_lg', dec_bush_02: 'shadow_lg',
    dec_bush_03: 'shadow_lg', dec_bush_04: 'shadow_lg',
    dec_flower_02: 'shadow_md',   // sunflowers
    dec_flower_01: 'shadow_sm',   // rose
  };

  // Baked shadows, ported from the Asset Library's bake-shadows.lua. A shadow is
  // not a translucent wash — every pixel it covers is REPLACED with the palette
  // entry one perceptual step below whatever ground is underneath it. That's what
  // keeps a shadow reading as the same material in shade rather than as grey
  // film, and it's why a shadow spanning grass and dirt gets both halves right.
  //
  // PALETTE is mac-asset-library-64.gpl in index order; SHADE is the lua's
  // hand-tuned index -> darker index map. Both are copied verbatim — if either
  // changes over there, re-copy rather than re-deriving.
  const PALETTE = [
    0xff00ff, 0xffffff, 0x858585, 0x686868, 0x3d3d3d, 0x000000, 0xb6a8af, 0xa6979f,
    0x7c6e75, 0x564b50, 0x8f9aa2, 0x737d85, 0x58626a, 0x3e484f, 0xd7c6b2, 0xae9e8c,
    0xf4e4a4, 0xe5bf69, 0xc9a659, 0xb2924a, 0x9f8560, 0x816946, 0x634f30, 0xae725d,
    0x91523c, 0x734434, 0x50382e, 0x392c20, 0xf2cb4d, 0xce5f23, 0x4e774d, 0x3e6b3e,
    0x335b33, 0x1e461f, 0x0a3410, 0x2c6239, 0x1a4e29, 0x083b19, 0x467a5e, 0x2e6448,
    0x235143, 0x123e31, 0x072e23, 0xa7c9e7, 0x7896d1, 0x4775ba, 0x275a9a, 0x1d2b53,
    0x83769c, 0x3b3b58, 0x343345, 0xcd4051, 0xaf3476, 0x7e2553, 0xff004d, 0xf64d18,
    0xf6a513, 0xefec1f, 0x41be28, 0x1ac19a, 0x1dc2d4, 0x198ae1, 0x534be4, 0xe03cd6,
  ];

  const SHADE = [
    0, 2, 3, 4, 9, 5, 6, 8, 9, 5, 15, 21, 14, 21, 21, 7,
    8, 15, 19, 21, 22, 22, 23, 26, 25, 26, 27, 27, 28, 32, 32, 36,
    37, 34, 34, 37, 37, 33, 39, 40, 40, 42, 43, 44, 45, 45, 47, 47,
    49, 49, 50, 51, 53, 53, 51, 28, 56, 18, 58, 59, 60, 43, 62, 63,
  ];

  // ground RGB (packed 0xRRGGBB) -> its shaded RGB. Built once.
  const SHADE_RGB = new Map();
  for (let i = 0; i < PALETTE.length; i++) {
    const to = SHADE[i];
    if (to !== undefined && to !== i) SHADE_RGB.set(PALETTE[i], PALETTE[to]);
  }

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

  // ---- geometry ----
  // Everything is positioned in BOARD SQUARES and converted here, once, to whole
  // device pixels. Two reasons that matters:
  //
  //  - The canvas backing store is exactly the device-pixel size of the board, so
  //    the browser never rescales the canvas afterwards. Any resampling happens
  //    once, inside drawImage with smoothing off. A backing store at some tidy
  //    multiple of 32 that then gets CSS-scaled to fit is what made this blurry:
  //    on a 125%-zoom Windows display it landed on a ~1.07x rescale, which is the
  //    worst case there is.
  //  - Rounding the square boundaries (rather than the tile size) means adjacent
  //    tiles always share an edge exactly, with no seams or double-drawn columns
  //    when a square works out to a fractional number of device pixels.
  function geometry(w, h, cellPx, dpr) {
    const at = (sq) => Math.round(sq * cellPx * dpr);
    return {
      w, h,
      width: at(w), height: at(h),
      // The device-pixel rect of the 1x1 square whose top-left corner is (x, y).
      rect(x, y) {
        const x0 = at(x), y0 = at(y);
        return { x: x0, y: y0, w: at(x + 1) - x0, h: at(y + 1) - y0 };
      },
      // CSS pixels -> device pixels, for line weights.
      lw: (css) => Math.max(1, Math.round(css * dpr)),
    };
  }

  // ---- painting ----
  function blit(ctx, sheet, col, row, r) {
    ctx.drawImage(sheets[sheet], col * TS, row * TS, TS, TS, r.x, r.y, r.w, r.h);
  }

  // Props can be drawn mirrored for variety. A horizontal flip is exact under
  // nearest-neighbour, so it costs nothing in sharpness.
  function blitNamed(ctx, name, r, flip) {
    const a = ATLAS[name];
    if (!a) return;
    if (!flip) { blit(ctx, a[0], a[1], a[2], r); return; }
    ctx.save();
    ctx.translate(r.x + r.w, r.y);
    ctx.scale(-1, 1);
    ctx.drawImage(sheets[a[0]], a[1] * TS, a[2] * TS, TS, TS, 0, 0, r.w, r.h);
    ctx.restore();
  }

  // Rotations are exact multiples of 90°, so nearest-neighbour sampling stays
  // pixel-exact — no smoothing, no half-pixel drift.
  /**
   * Draw a sprite that may span more than one cell.
   *
   * Anchored at the BOTTOM-left, so a two-tall building placed on a square
   * stands on it and rises into the squares above, the same way a tree does.
   * Placing anchored at the top would have you clicking empty sky to put a
   * house down.
   */
  function blitSprite(ctx, name, g, x, y, rot, flip) {
    const a = ATLAS[name];
    if (!a) return;
    const [w, h] = sizeOf(name);

    if (w === 1 && h === 1) {
      if (!rot) { blitNamed(ctx, name, g.rect(x, y), flip); return; }
      const r = g.rect(x, y);
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate((rot / 90) * Math.PI / 2);
      // Mirror after turning, so flip always reads as left-to-right on the
      // sprite itself rather than depending on how far it has been rotated.
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(sheets[a[0]], a[1] * TS, a[2] * TS, TS, TS, -r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
      return;
    }

    // Multi-cell: mirroring means reversing the column order AND mirroring each
    // cell. Doing only one of the two turns a building inside out.
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const srcX = flip ? (w - 1 - dx) : dx;
        const r = g.rect(x + dx, y - (h - 1) + dy);
        if (!flip) {
          ctx.drawImage(sheets[a[0]], (a[1] + srcX) * TS, (a[2] + dy) * TS, TS, TS, r.x, r.y, r.w, r.h);
          continue;
        }
        ctx.save();
        ctx.translate(r.x + r.w, r.y);
        ctx.scale(-1, 1);
        ctx.drawImage(sheets[a[0]], (a[1] + srcX) * TS, (a[2] + dy) * TS, TS, TS, 0, 0, r.w, r.h);
        ctx.restore();
      }
    }
  }

  function blitRotated(ctx, sheet, col, row, r, rot) {
    if (rot === 0) { blit(ctx, sheet, col, row, r); return; }
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.rotate((rot * Math.PI) / 2);
    ctx.drawImage(sheets[sheet], col * TS, row * TS, TS, TS, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.restore();
  }

  // Paint one material, autotiled, on the SAME aligned grid as everything else.
  //
  // The material lives on the grid's CORNERS, not its squares: each tile is
  // chosen by which of its own four corners are the material. That keeps every
  // tile — terrain, decor, props — on one 32px grid, which is how the art is
  // authored. (An earlier version put the material on squares and offset the
  // terrain grid by half a tile instead. Same shapes, but the ground then sat
  // half a square off from everything else and hung over the board edges.)
  //
  // `isMat(i, j)` answers "is corner (i, j) this material?".
  function paintMaterial(ctx, material, g, isMat) {
    const row = MATERIAL_ROW[material];
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const mask = (isMat(x,     y)     ? 0b1000 : 0)    // NW corner
                   | (isMat(x + 1, y)     ? 0b0100 : 0)    // NE
                   | (isMat(x,     y + 1) ? 0b0010 : 0)    // SW
                   | (isMat(x + 1, y + 1) ? 0b0001 : 0);   // SE
        if (mask === 0) continue;                          // nothing to draw
        const shape = AUTOTILE[mask];
        blitRotated(ctx, 't', shape.col, row, g.rect(x, y), shape.rot);
      }
    }
  }

  // Bake shadows into the ground, the way bake-shadows.lua does it: every pixel
  // the shadow sprite covers is replaced with the palette entry one step darker
  // than the ground already there. Not a translucent overlay — grass in shade
  // stays grass, dirt in shade stays dirt, and a shadow straddling both gets
  // each half right.
  //
  // Runs square by square rather than over one big region: a shadow sprite never
  // leaves its own square, so this touches only the squares that have one
  // instead of reading back the whole board.
  function bakeShadows(ctx, canvas, shadows, g) {
    if (!shadows.length) return;
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const mctx = mask.getContext('2d');
    mctx.imageSmoothingEnabled = false;
    for (const s of shadows) blitNamed(mctx, s.sprite, g.rect(s.x, s.y), false);

    for (const s of shadows) {
      const r = g.rect(s.x, s.y);
      const shade = mctx.getImageData(r.x, r.y, r.w, r.h);
      const ground = ctx.getImageData(r.x, r.y, r.w, r.h);
      const sd = shade.data, gd = ground.data;
      let touched = false;
      for (let i = 0; i < sd.length; i += 4) {
        if (sd[i + 3] < 128) continue;                 // not shadow here
        if (gd[i + 3] === 0) continue;                 // nothing under it
        const to = SHADE_RGB.get((gd[i] << 16) | (gd[i + 1] << 8) | gd[i + 2]);
        if (to === undefined) continue;                // no darker entry: leave it
        gd[i] = (to >> 16) & 255; gd[i + 1] = (to >> 8) & 255; gd[i + 2] = to & 255;
        touched = true;
      }
      if (touched) ctx.putImageData(ground, r.x, r.y);
    }
  }

  // Size a canvas to the board's exact device-pixel footprint and hand back a
  // cleared context. No CSS rescale happens after this, which is the whole point.
  function prepare(canvas, g, cellPx) {
    canvas.width  = g.width;
    canvas.height = g.height;
    canvas.style.width  = `${g.w * cellPx}px`;
    canvas.style.height = `${g.h * cellPx}px`;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return ctx;
  }

  // A ring where a unit is, drawn on top of the leaves that hide it. The token
  // itself is a DOM element under the canopy canvas — this is just its outline
  // promoted to the very top so you never lose track of a unit standing in a
  // tree. Matches .combatant's border colours in game.css.
  // Board-effect tile outlines, same hues as the .cell.tile-* rules in game.css.
  const TILE_OUTLINE = {
    block:  'rgba(25, 138, 225, 0.9)',
    buff:   'rgba(242, 203, 77, 0.9)',
    hazard: 'rgba(205, 64, 81, 0.9)',
    slow:   'rgba(178, 146, 74, 0.9)',
  };

  // A board-effect tile's outline and label, redrawn above the canopy. The cell's
  // tint is lost under leaves and that's acceptable — but a buff or a hazard you
  // can't see is a trap, so the two parts that say "something is on this square"
  // and "here's what" come back on top. Stopgap until trees become custom tiles
  // that know what's under them.
  function drawTileMark(ctx, mark, g) {
    const r = g.rect(mark.x, mark.y);
    const lw = g.lw(2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = TILE_OUTLINE[mark.kind] || 'rgba(255, 255, 255, 0.8)';
    ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, r.w - lw, r.h - lw);

    if (!mark.label) return;
    const size = g.lw(15);
    ctx.font = `bold ${size}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // Dark outline first so the label reads against foliage as well as ground.
    ctx.lineWidth = Math.max(2, g.lw(2));
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.strokeText(mark.label, cx, cy);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(mark.label, cx, cy);
  }

  function drawTokenRing(ctx, unit, isOwn, isSelected, g) {
    const span = unit.size || 1;
    const a = g.rect(unit.pos.x, unit.pos.y);
    const b = g.rect(unit.pos.x + span - 1, unit.pos.y + span - 1);
    const lw = g.lw(2);                                  // matches .combatant's border
    const cx = (a.x + b.x + b.w) / 2, cy = (a.y + b.y + b.h) / 2;
    const r = (b.x + b.w - a.x - lw) / 2;

    // Dark ring just outside the coloured one, so it holds up against foliage.
    ctx.lineWidth = lw * 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

    ctx.lineWidth = lw;
    ctx.strokeStyle = isSelected ? '#f9d65c' : isOwn ? '#198ae1' : '#cd4051';
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
   *   tileMarks      board-effect tiles to re-outline above the leaves
   *   onReady        re-render callback, used if the sheets are still loading
   *
   * Returns false and leaves the canvases alone if there's nothing to draw yet.
   */
  function paintTerrain(canvases, board, cellPx, opts) {
    const terrain = board && board.terrain;
    if (!terrain) return false;
    if (!ready) { waiting.push(opts.onReady); return false; }

    const g = geometry(terrain.width, terrain.height, cellPx, window.devicePixelRatio || 1);
    const ctx = prepare(canvases.ground, g, cellPx);

    // 1. dirt — the base everything else sits on, so it's a flat fill.
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++)
        blit(ctx, 't', 0, MATERIAL_ROW.dirt, g.rect(x, y));

    // 2. grass — autotiled over the dirt from the CORNER lattice. Dirt is the
    // rare thing, so what shows through reads as bare earth worn into a forest
    // floor rather than as terrain in its own right.
    paintMaterial(ctx, 'grass', g, (i, j) => terrain.corners[j][i] === 'g');

    // 3. grass overlay — tufts that break up the flat fill.
    for (const o of terrain.overlay) blitNamed(ctx, o.s, g.rect(o.x, o.y), o.f);

    // Obstacles are dressed from live state, not baked: a destroyed one is
    // walkable, so it loses its canopy and becomes rubble.
    const state = new Map();
    for (const o of board.obstacles) state.set(`${o.pos.x},${o.pos.y}`, o.state);
    const props = terrain.obstacles.map((p) => {
      const dead = state.get(`${p.x},${p.y}`) === 'destroyed';
      return { x: p.x, y: p.y, f: p.f, stack: dead ? [p.rubble] : p.stack };
    });
    // A placed tree is a prop, not decor: it has a trunk on its square and a
    // canopy leaning into the squares above, and anything standing under it
    // belongs behind the leaves. Flat objects stay in the decor pass below.
    const placed = board.objects || [];
    for (const o of placed) {
      if (Array.isArray(o.stack) && o.stack.length) {
        props.push({ x: o.x, y: o.y, f: !!o.f, stack: o.stack });
      }
    }

    // 4. shadows — LAST thing decided, first thing drawn. Which shadow a square
    // gets depends on the sprite standing on it, so the set can't be worked out
    // until every prop is placed; but it belongs under the decor, so once it's
    // known it goes down before them. Baked into the ground, not laid over it.
    const shadows = [];
    for (const s of terrain.scatter) {
      const sprite = SHADOW_FOR[s.s];
      if (sprite) shadows.push({ x: s.x, y: s.y, sprite });
    }
    for (const p of props) {
      const sprite = SHADOW_FOR[p.stack[0]];
      if (sprite) shadows.push({ x: p.x, y: p.y, sprite });
    }
    for (const o of placed) {
      // Stacked ones already went through props above and got theirs there.
      if (Array.isArray(o.stack) && o.stack.length) continue;
      const sprite = SHADOW_FOR[o.sprite];
      if (sprite) shadows.push({ x: o.x, y: o.y, sprite });
    }
    bakeShadows(ctx, canvases.ground, shadows, g);

    // 5. decor — scatter, then the part of each prop that stands on its square,
    // then anything placed. Placed objects go last so a fire dropped on a patch
    // of flowers sits on top of them rather than under.
    for (const s of terrain.scatter) blitNamed(ctx, s.s, g.rect(s.x, s.y), s.f);
    for (const p of props) blitNamed(ctx, p.stack[0], g.rect(p.x, p.y), p.f);
    const flat = placed
      .filter(o => !(Array.isArray(o.stack) && o.stack.length))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const o of flat) blitSprite(ctx, o.sprite, g, o.x, o.y, o.rot, o.f);

    // No square lines and no coordinates: the board is a place, not a
    // spreadsheet. What you can do with a square is shown when it matters — the
    // move and target highlights are still per-square — so the lines were only
    // ever chrome laid over the art.

    // 6. above decor, on its own canvas above the tokens.
    const top = prepare(canvases.canopy, g, cellPx);
    const covered = new Set();
    // Row first, so a nearer tree overlaps a farther one rather than the
    // reverse. Within a row the order used to fall to whatever sequence the
    // obstacles were scattered in, which is arbitrary and reads as such where
    // two canopies meet.
    //
    // Ties now go to the taller tree, drawn FIRST and so behind. Height already
    // varies per tree and the two builds differ in it, so neighbours separate
    // by themselves without either build being permanently in front: a tall
    // tree 02 sits behind its neighbour, a short one in front of the same tree.
    // x last, only so the result is stable rather than dependent on input
    // order.
    const depth = (p) => [p.y, -p.stack.length, p.x];
    for (const p of [...props].sort((a, b) => {
      const A = depth(a), B = depth(b);
      return (A[0] - B[0]) || (A[1] - B[1]) || (A[2] - B[2]);
    })) {
      for (let i = 1; i < p.stack.length; i++) {
        blitNamed(top, p.stack[i], g.rect(p.x, p.y - i), p.f);
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
        const r = g.rect(+hx, +hy);
        top.fillRect(r.x, r.y, r.w, r.h);
      }
      top.globalCompositeOperation = 'source-over';
    }

    // Board-effect tiles the leaves reach get their outline and label back.
    for (const mark of opts.tileMarks || []) {
      if (covered.has(`${mark.x},${mark.y}`)) drawTileMark(top, mark, g);
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
      drawTokenRing(top, unit, unit.teamId === opts.playerTeamId, key === opts.selectedKey, g);
    }

    return true;
  }

  window.paintTerrain = paintTerrain;

  // What the place tool needs to build its own palette. Names and footprints
  // only: an earlier version handed over sheet coordinates so a swatch could be
  // a CSS crop, which meant the palette doing its own arithmetic against a
  // sheet whose size it did not know. Drawing is this file's job, so it draws.
  window.spriteCatalogue = () => ({
    sprites: Object.fromEntries(
      Object.keys(ATLAS)
        .filter(n => !n.startsWith('shadow_'))
        .map(n => [n, { size: sizeOf(n) }]),
    ),
  });

  /**
   * Draw one sprite into a canvas at `scale`, sized to fit it.
   *
   * Goes through the same sheets and the same cell arithmetic the board uses,
   * so a swatch cannot drift from what placing it actually puts down, and a
   * multi-cell building shows whole rather than as its top-left corner.
   */
  window.drawSprite = (canvas, name, scale = 2, rot = 0, flip = false) => {
    const a = ATLAS[name];
    if (!a || !ready) return false;
    const [w, h] = sizeOf(name);
    canvas.width = w * TS * scale;
    canvas.height = h * TS * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const cell = TS * scale;
    if (w === 1 && h === 1) {
      ctx.save();
      ctx.translate(cell / 2, cell / 2);
      if (rot) ctx.rotate((rot / 90) * Math.PI / 2);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(sheets[a[0]], a[1] * TS, a[2] * TS, TS, TS, -cell / 2, -cell / 2, cell, cell);
      ctx.restore();
      return true;
    }
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const srcX = flip ? (w - 1 - dx) : dx;
        ctx.save();
        if (flip) { ctx.translate((dx + 1) * cell, dy * cell); ctx.scale(-1, 1); }
        else ctx.translate(dx * cell, dy * cell);
        ctx.drawImage(sheets[a[0]], (a[1] + srcX) * TS, (a[2] + dy) * TS, TS, TS, 0, 0, cell, cell);
        ctx.restore();
      }
    }
    return true;
  };

  /** Run `cb` once the sheets are loaded, or straight away if they already are. */
  window.spritesReady = (cb) => { if (ready) cb(); else waiting.push(cb); };
})();
