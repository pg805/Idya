// Map view — draws a chunk of the world.
//
// Reuses paintTerrain from the combat board unchanged: it takes a board-shaped
// { terrain, obstacles } and two canvases, and it doesn't care whether a fight
// is happening on them. The combat board puts the DOM cell grid between the two
// canvases; here there is no grid, so they simply stack.
//
// Read-only for now. Walking around and changing tiles come next.
window.Views = window.Views || {};
window.Views.map = (function () {

  const TILE_SRC = 32;   // the tileset's native tile size
  let chunk = { x: 0, y: 0 };
  let view = null;       // the loaded ChunkView
  let root = null;
  let onResize = null;

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

    const cell = cellSizeFor(stage.parentElement.clientWidth || 768);
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

    body.innerHTML = `
      <div class="map-stage-wrap">
        <div id="map-stage" class="map-stage loading">
          <canvas id="map-ground"></canvas>
          <canvas id="map-canopy"></canvas>
        </div>
      </div>`;

    root.querySelector('#map-place').textContent = view.place.name;
    root.querySelector('#map-blurb').textContent = view.place.blurb;
    root.querySelector('#map-coords').textContent = `(${chunk.x}, ${chunk.y})`;

    const exits = root.querySelector('#map-exits');
    exits.innerHTML = view.exits.length
      ? view.exits.map(e =>
          `<button class="map-exit" data-x="${e.x}" data-y="${e.y}">${esc(e.name)}</button>`,
        ).join('')
      : '<span class="map-note">Nowhere to go from here.</span>';
    for (const btn of exits.querySelectorAll('.map-exit')) {
      btn.addEventListener('click', () => load({ x: +btn.dataset.x, y: +btn.dataset.y }));
    }

    paint();
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

        <div class="map-exits" id="map-exits"></div>
        <div id="map-body"></div>
        <p class="map-scale" id="map-scale"></p>
      </div>`;

    onResize = () => paint();
    window.addEventListener('resize', onResize);
    load(chunk);
  }

  function unmount() {
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = null;
    view = null;
    root = null;
  }

  return { mount, unmount };
})();
