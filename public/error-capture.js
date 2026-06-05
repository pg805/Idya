// Catches unhandled JS errors + promise rejections and forwards them to the
// server (which logs to stdout / PM2). Runs before any view code so it can
// catch early-init crashes that produce a white screen.
//
// Throttled to one POST per error message per minute to avoid flooding the
// server if a render loop is spewing the same error.
(function() {
  const recent = new Map();   // message -> last posted timestamp
  const COOLDOWN_MS = 60_000;

  function post(payload) {
    const key = String(payload.message ?? '').slice(0, 200);
    const now = Date.now();
    const last = recent.get(key) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    recent.set(key, now);
    try {
      // sendBeacon survives page unload; falls back to fetch if unavailable.
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client_error', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/client_error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch (_) { /* swallow — capture must never crash the page */ }
  }

  window.addEventListener('error', (e) => {
    post({
      url:     location.href,
      message: e.message || (e.error && e.error.message) || 'error event',
      source:  e.filename,
      line:    e.lineno,
      col:     e.colno,
      stack:   e.error && e.error.stack,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    post({
      url:     location.href,
      message: 'unhandledrejection: ' + (reason && reason.message ? reason.message : String(reason)),
      stack:   reason && reason.stack,
    });
  });
})();
