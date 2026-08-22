// App shell.
//
// The map is the application. It mounts once into #world-root and stays there
// for the life of the page, so opening an interface never costs you your
// position or your socket. Everything else opens as a panel over it, and the
// sidebar is a pause menu rather than a permanent column.
//
// The URL does not change as you move around. It is read once on arrival, so a
// link from an email or from Discord can still land you on a particular screen,
// and then normalised back to /app.

const world      = document.getElementById('world-root');
const content    = document.getElementById('app-content');
const panel      = document.getElementById('panel');
const panelTitle = document.getElementById('panel-title');
const navLinks   = Array.from(document.querySelectorAll('.nav-link'));

let activeView = null;   // the view inside the panel, if one is open

// Map URL path → { viewName, params }. Still used for the arrival URL and for
// the menu's data-path attributes; it just no longer drives history.
function routeFromPath(path) {
  if (path === '/character')            return { viewName: 'character', params: {} };
  if (path === '/inventory')            return { viewName: 'inventory', params: {} };
  if (path === '/crafting' || path === '/craft') return { viewName: 'crafting', params: {} };
  if (path === '/upgrade')              return { viewName: 'upgrade', params: {} };
  if (path === '/enchant')              return { viewName: 'enchant', params: {} };
  if (path === '/orchard')              return { viewName: 'orchard', params: {} };
  if (path === '/professions')          return { viewName: 'professions', params: {} };
  if (path === '/enemies')              return { viewName: 'enemies', params: {} };
  if (path === '/lore')                 return { viewName: 'lore',    params: {} };
  if (path === '/reference')            return { viewName: 'reference', params: {} };
  if (path === '/about')                return { viewName: 'about',     params: {} };
  if (path === '/settings')             return { viewName: 'settings',  params: {} };
  if (path === '/chat')                 return { viewName: 'chat',      params: {} };
  if (path === '/hunt')                 return { viewName: 'hunt',    params: {} };
  if (path === '/trade')                return { viewName: 'trade-start', params: {} };
  if (path === '/create')               return { viewName: 'create',  params: {} };
  if (path === '/weapon-stats')         return { viewName: 'weapons', params: {} };
  if (path === '/market')               return { viewName: 'market', params: {} };
  if (path === '/stats')                return { viewName: 'stats', params: {} };
  if (path === '/town-square')          return { viewName: 'town_square', params: {} };
  if (path === '/dev/stats')            return { viewName: 'dev_stats', params: {} };
  if (path === '/dev/replay')           return { viewName: 'dev_replay', params: {} };
  if (path === '/dev/matrix')           return { viewName: 'dev_matrix', params: {} };
  if (path === '/dev/prices')           return { viewName: 'dev_price_history', params: {} };
  const m = path.match(/^\/shop\/([^/]+)$/);
  if (m) return { viewName: 'shop', params: { shopKey: m[1] } };
  const t = path.match(/^\/trade\/([^/]+)$/);
  if (t) return { viewName: 'trade', params: { tradeId: t[1] } };
  return null;   // '/map', '/', and anything unknown mean "just the world"
}

function labelFor(path) {
  const link = navLinks.find(l => l.dataset.path === path);
  return link ? link.textContent.trim() : '';
}

// ---- panel ----

async function openPanel(path) {
  const route = routeFromPath(path);
  if (!route) { closePanel(); return; }

  const view = window.Views?.[route.viewName];
  if (!view) {
    content.innerHTML = `<div class="splash"><p>Unknown view: ${route.viewName}</p></div>`;
    return;
  }

  if (activeView?.unmount) {
    try { activeView.unmount(); } catch (_) {}
  }
  activeView = view;

  for (const link of navLinks) link.classList.toggle('active', link.dataset.path === path);
  panelTitle.textContent = labelFor(path);
  panel.hidden = false;
  document.body.classList.add('panel-open');
  content.innerHTML = '';
  content.scrollTop = 0;
  await view.mount(content, route.params);
}

function closePanel() {
  if (activeView?.unmount) {
    try { activeView.unmount(); } catch (_) {}
  }
  activeView = null;
  panel.hidden = true;
  document.body.classList.remove('panel-open');
  content.innerHTML = '';
  for (const link of navLinks) link.classList.remove('active');
}

// ---- pause menu ----

function openMenu()  { document.body.classList.add('menu-open'); }
function closeMenu() { document.body.classList.remove('menu-open'); }
function toggleMenu() { document.body.classList.toggle('menu-open'); }

// The verify banner and anything else in shared chrome routes through this.
window.navigate = (path) => { closeMenu(); openPanel(path); };
window.closePanel = closePanel;

document.getElementById('menu-toggle')?.addEventListener('click', toggleMenu);
document.getElementById('menu-backdrop')?.addEventListener('click', closeMenu);
document.getElementById('panel-close')?.addEventListener('click', closePanel);

for (const link of navLinks) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    closeMenu();
    // '/map' is the world itself, so choosing it just gets out of the way.
    if (link.dataset.path === '/map') closePanel();
    else openPanel(link.dataset.path);
  });
}

// Escape backs out one layer at a time: the panel, then the menu. With nothing
// open it brings the menu up, which is what a pause key should do.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
  if (!panel.hidden) closePanel();
  else if (document.body.classList.contains('menu-open')) closeMenu();
  else openMenu();
});

// ---- boot ----

function arrivalPath() {
  const p = location.pathname;
  if (p === '/app' || p === '/app/') return null;
  return p.startsWith('/app/') ? p.slice(4) : null;
}

(async function init() {
  await claimAuthFromUrl();
  // Compact header: the profession row is a tall block and the map needs the
  // height more than a permanent readout does. Professions are still on the
  // Professions screen.
  await mountLayout({ title: 'Legacy of Apolis', compact: true });

  const layoutData = window.getLayoutData?.();
  if (layoutData?.tutorial_session_id && !location.pathname.startsWith('/battle/')) {
    location.href = `/battle/${layoutData.tutorial_session_id}`;
    return;
  }

  const arrived = arrivalPath();

  // No character yet means there is nothing to put on the map; the only useful
  // thing to show is the thing that makes one.
  if (!layoutData?.authenticated || arrived === '/create') {
    await openPanel('/create');
  } else {
    // The world is always there, underneath whatever else is open.
    await window.Views?.map?.mount(world);
    if (arrived) await openPanel(arrived);
  }

  // Honour the URL we arrived on, once, then stop using it.
  history.replaceState(null, '', '/app');

  if (typeof window.maybeStartTour === 'function') window.maybeStartTour();
})();
