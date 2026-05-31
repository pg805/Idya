// App shell — single-page navigation. No iframes.

const content    = document.getElementById('app-content');
const navLinks   = Array.from(document.querySelectorAll('.nav-link'));
const DEFAULT_PATH = '/craft';

let activeView = null;

// Map URL path → { viewName, params }
function routeFromPath(path) {
  if (path === '/' || path === '') return { viewName: 'craft', params: {} };
  if (path === '/craft') return { viewName: 'craft', params: {} };
  if (path === '/weapon-stats') return { viewName: 'weapons', params: {} };
  const m = path.match(/^\/shop\/([^/]+)$/);
  if (m) return { viewName: 'shop', params: { shopKey: m[1] } };
  return { viewName: 'craft', params: {} };
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
  window.onLayoutChange = null;
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
  await navigate(viewPathFromUrl(), { push: false });
})();
