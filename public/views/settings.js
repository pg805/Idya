// Settings view — how you sign in, and your preferences.
//
// This is the settings page. The header popover keeps only the one preference
// that has to be reachable mid-combat (quick actions) and otherwise points here.
//
// It's also the page that gets a Discord-only player off the bot: they set an
// email and password here and can sign in either way afterwards. Linking never
// detaches Discord, so a typo can't lock anyone out.
window.Views = window.Views || {};
window.Views.settings = (function () {

  const QUICK_KEY = 'idya.battle_quick';

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function render(root) {
    root.innerHTML = '<div class="splash"><p>Loading…</p></div>';

    let methods;
    try {
      const res = await fetch('/api/auth/methods', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('unauthorized');
      methods = await res.json();
    } catch (_) {
      root.innerHTML = '<div class="splash"><p>Could not load your account.</p></div>';
      return;
    }

    // Server-side preference; falls back to off, matching the column default.
    let pingOn = false;
    try {
      const res = await fetch('/api/settings', { credentials: 'same-origin' });
      if (res.ok) pingOn = !!(await res.json()).ping_on_action;
    } catch (_) {}

    const quickOn = localStorage.getItem(QUICK_KEY) === '1';
    const email = methods.email;

    root.innerHTML = `
      <div class="settings-view">
        <h2 class="settings-heading">Settings</h2>

        <section class="settings-card">
          <h3>Email</h3>
          ${email ? `
            <p class="settings-value">${esc(email.address)}</p>
            ${email.verified
              ? '<p class="settings-ok">Confirmed</p>'
              : `<p class="settings-warn">Not confirmed yet. Until you confirm it, there's no way
                 back into your account if you lose your password.</p>
                 <button class="settings-btn" id="resend-btn" type="button">Send the link again</button>
                 <p class="settings-msg" id="resend-msg" hidden></p>`}
          ` : `
            <p class="settings-help">
              Add an email and password so you can sign in without Discord.
              This doesn't remove Discord, you'll be able to use either.
            </p>
            <form id="link-form" class="settings-form">
              <label class="settings-label" for="link-email">Email</label>
              <input class="settings-input" id="link-email" type="email" required
                     autocomplete="email" spellcheck="false">

              <label class="settings-label" for="link-password">Password</label>
              <input class="settings-input" id="link-password" type="password" required
                     minlength="8" autocomplete="new-password">
              <p class="settings-help">At least 8 characters.</p>

              <p class="settings-error" id="link-error" hidden></p>
              <button class="settings-btn" type="submit" id="link-btn">Add email</button>
            </form>
          `}
        </section>

        <section class="settings-card">
          <h3>Discord</h3>
          <p class="${methods.discord ? 'settings-ok' : 'settings-help'}">
            ${methods.discord ? 'Linked' : 'Not linked'}
          </p>
        </section>

        <section class="settings-card">
          <h3>Preferences</h3>

          <div class="settings-pref">
            <label class="settings-pref-label" for="pref-ping">Ping me on Discord</label>
            <input id="pref-ping" class="settings-toggle" type="checkbox" ${pingOn ? 'checked' : ''}>
          </div>
          <p class="settings-help">
            When on, Discord posts that mention you use a ping instead of your character name.
          </p>

          <div class="settings-pref">
            <label class="settings-pref-label" for="pref-quick">Quick actions in combat</label>
            <input id="pref-quick" class="settings-toggle" type="checkbox" ${quickOn ? 'checked' : ''}>
          </div>
          <p class="settings-help">
            When on, actions fire the moment you pick them. Off lets you review and confirm first.
            This one is per device.
          </p>
        </section>

        <button class="settings-btn signout" id="signout-btn" type="button">Sign out</button>
      </div>`;

    root.querySelector('#pref-ping')?.addEventListener('change', async (e) => {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ping_on_action: e.target.checked }),
      }).catch(() => {});
    });

    root.querySelector('#pref-quick')?.addEventListener('change', (e) => {
      localStorage.setItem(QUICK_KEY, e.target.checked ? '1' : '0');
      // Combat listens for this so the action panel re-renders live.
      window.dispatchEvent(new CustomEvent('commitmode-change'));
    });

    root.querySelector('#signout-btn')?.addEventListener('click', () => window.idyaLogout?.());

    root.querySelector('#resend-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const msg = root.querySelector('#resend-msg');
      btn.disabled = true;
      const result = await idyaPost('/api/auth/resend-verification', {});
      msg.textContent = result.ok
        ? 'Sent. Check your inbox, and your spam folder.'
        : (result.error || 'Could not send right now.');
      msg.hidden = false;
      if (!result.ok) btn.disabled = false;
    });

    root.querySelector('#link-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = root.querySelector('#link-btn');
      const err = root.querySelector('#link-error');
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Adding…';

      const result = await idyaPost('/api/auth/link-email', {
        email: root.querySelector('#link-email').value,
        password: root.querySelector('#link-password').value,
      });

      if (result.ok) { await render(root); return; }
      err.textContent = result.error || 'Something went wrong.';
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Add email';
    });
  }

  return { mount: (root) => render(root) };
})();
