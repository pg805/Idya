// App shell: sidebar navigation, deep-linkable URLs, iframe-loaded views.

async function claimAuth() {
  const auth = new URLSearchParams(location.search).get('auth');
  if (!auth) return;
  try {
    const res = await fetch('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: auth }),
    });
    if (res.ok) {
      // Keep localStorage in sync for legacy iframe pages that still read Bearer.
      localStorage.setItem('shop_auth', auth);
    }
  } catch (_) {}
  history.replaceState(null, '', location.pathname);
}

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
  await claimAuth();
  navigate(viewPathFromUrl(), { push: false });
})();
