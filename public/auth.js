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
