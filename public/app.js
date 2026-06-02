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
  if (path === '/hunt')                 return { viewName: 'hunt',    params: {} };
  if (path === '/trade')                return { viewName: 'trade-start', params: {} };
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
    navigate(link.dataset.path);
  });
}

window.addEventListener('popstate', () => {
  navigate(viewPathFromUrl(), { push: false });
});

(async function init() {
  await claimAuthFromUrl();
  await mountLayout({ title: 'Idya' });
  await navigate(viewPathFromUrl(), { push: false });
})();
