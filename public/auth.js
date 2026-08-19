// Shared: claim ?auth=TOKEN from URL into a session cookie, then strip it from the URL.
// Safe to call multiple times; no-op if no token in URL.
async function claimAuthFromUrl() {
  const auth = new URLSearchParams(location.search).get('auth');
  if (!auth) return;
  try {
    await fetch('/api/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: auth }),
    });
  } catch (_) {}
  const params = new URLSearchParams(location.search);
  params.delete('auth');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
}

// Who the server thinks we are. Null on network failure, so callers can tell
// "definitely signed out" (authenticated: false) from "couldn't ask".
async function idyaWhoAmI() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return { authenticated: false };
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Drop the session and return to the front door.
async function idyaLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (_) {}
  location.href = '/';
}

// ---- Expired-session handling ----
//
// Every view fetches on its own, and none of them check for 401 — so before
// this, an expired session rendered a blank page with no explanation. Wrapping
// fetch once here covers all of them without touching a single view file.
(function interceptUnauthorized() {
  const original = window.fetch;
  // Endpoints where a 401 is a normal answer rather than an expired session.
  const EXPECTS_401 = ['/api/auth/claim', '/api/auth/me'];

  window.fetch = async function (...args) {
    const res = await original.apply(this, args);
    try {
      if (res.status !== 401) return res;

      const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), location.origin);
      if (url.origin !== location.origin) return res;
      if (!url.pathname.startsWith('/api/')) return res;
      if (EXPECTS_401.some(p => url.pathname.startsWith(p))) return res;
      // Already on the landing page — bouncing again would loop.
      if (location.pathname === '/') return res;

      location.href = '/?expired=1';
    } catch (_) { /* never let the interceptor break a request */ }
    return res;
  };
})();
