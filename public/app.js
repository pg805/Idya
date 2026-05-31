// App shell: sidebar navigation, deep-linkable URLs, iframe-loaded views.

// claimAuthFromUrl is loaded from /auth.js (shared)

const frame      = document.getElementById('view-frame');
const navLinks   = Array.from(document.querySelectorAll('.nav-link'));
const DEFAULT_PATH = '/craft';

function viewPathFromUrl() {
  // /app           → DEFAULT_PATH
  // /app/foo       → /foo
  // /app/foo/bar   → /foo/bar
  let p = location.pathname;
  if (p === '/app' || p === '/app/') return DEFAULT_PATH;
  if (p.startsWith('/app/')) return p.slice(4);
  return DEFAULT_PATH;
}

function navigate(viewPath, { push = true } = {}) {
  if (push) history.pushState(null, '', '/app' + viewPath);
  frame.src = viewPath + '?embedded=1';
  for (const link of navLinks) {
    link.classList.toggle('active', link.dataset.path === viewPath);
  }
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
  navigate(viewPathFromUrl(), { push: false });
})();
