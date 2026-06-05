// App shell — single-page navigation. No iframes.

const content    = document.getElementById('app-content');
const navLinks   = Array.from(document.querySelectorAll('.nav-link'));
const DEFAULT_PATH = '/character';

let activeView = null;

// Map URL path → { viewName, params }
function routeFromPath(path) {
  if (path === '/' || path === '')      return { viewName: 'character', params: {} };
  if (path === '/character')            return { viewName: 'character', params: {} };
  if (path === '/inventory')            return { viewName: 'inventory', params: {} };
  if (path === '/crafting' || path === '/craft') return { viewName: 'crafting', params: {} };
  if (path === '/upgrade')              return { viewName: 'upgrade', params: {} };
  if (path === '/enchant')              return { viewName: 'enchant', params: {} };
  if (path === '/professions')          return { viewName: 'professions', params: {} };
  if (path === '/enemies')              return { viewName: 'enemies', params: {} };
  if (path === '/lore')                 return { viewName: 'lore',    params: {} };
  if (path === '/reference')            return { viewName: 'reference', params: {} };
  if (path === '/hunt')                 return { viewName: 'hunt',    params: {} };
  if (path === '/trade')                return { viewName: 'trade-start', params: {} };
  if (path === '/create')               return { viewName: 'create',  params: {} };
  if (path === '/weapon-stats')         return { viewName: 'weapons', params: {} };
  const m = path.match(/^\/shop\/([^/]+)$/);
  if (m) return { viewName: 'shop', params: { shopKey: m[1] } };
  const t = path.match(/^\/trade\/([^/]+)$/);
  if (t) return { viewName: 'trade', params: { tradeId: t[1] } };
  return { viewName: 'character', params: {} };
}

function viewPathFromUrl() {
  let p = location.pathname;
  if (p === '/app' || p === '/app/') return DEFAULT_PATH;
  if (p.startsWith('/app/')) return p.slice(4);
  return DEFAULT_PATH;
}

async function navigate(viewPath, { push = true } = {}) {
  if (push) history.pushState(null, '', '/app' + viewPath);
  for (const link of navLinks) {
    link.classList.toggle('active', link.dataset.path === viewPath);
  }
  const { viewName, params } = routeFromPath(viewPath);
  const view = window.Views?.[viewName];
  if (!view) {
    content.innerHTML = `<div class="splash"><p>Unknown view: ${viewName}</p></div>`;
    return;
  }
  if (activeView && activeView.unmount) {
    try { activeView.unmount(); } catch (_) {}
  }
  activeView = view;
  content.innerHTML = '';
  await view.mount(content, params);
}

for (const link of navLinks) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.body.classList.remove('menu-open');
    navigate(link.dataset.path);
  });
}

// Mobile drawer toggle. The hamburger button and backdrop are sibling
// elements at the top of <body>; tapping either toggles or closes the
// drawer, and any nav-link click also closes (handled above).
document.getElementById('mobile-menu-toggle')?.addEventListener('click', () => {
  document.body.classList.toggle('menu-open');
});
document.getElementById('mobile-menu-backdrop')?.addEventListener('click', () => {
  document.body.classList.remove('menu-open');
});

window.addEventListener('popstate', () => {
  navigate(viewPathFromUrl(), { push: false });
});

(async function init() {
  await claimAuthFromUrl();
  await mountLayout({ title: 'Idya' });
  await navigate(viewPathFromUrl(), { push: false });
  // After the layout + first view are in the DOM, trigger the sidebar walkthrough
  // when the URL forces it (?tour=1, set by the tutorial's Go to Town link).
  if (typeof window.maybeStartTour === 'function') window.maybeStartTour();
})();
