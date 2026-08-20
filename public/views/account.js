// Account view — how you sign in, and confirming your address.
//
// This is the page that gets a Discord-only player off the bot: they set an
// email and password here and can sign in either way afterwards. Linking never
// detaches Discord, so a typo can't lock anyone out.
window.Views = window.Views || {};
window.Views.account = (function () {

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

    const email = methods.email;

    root.innerHTML = `
      <div class="account-view">
        <h2 class="account-heading">How you sign in</h2>

        <section class="account-card">
          <h3>Email</h3>
          ${email ? `
            <p class="account-value">${esc(email.address)}</p>
            ${email.verified
              ? '<p class="account-ok">Confirmed</p>'
              : `<p class="account-warn">Not confirmed yet — until you confirm it, you can't use this
                 address to recover your account.</p>
                 <button class="account-btn" id="resend-btn" type="button">Send the link again</button>
                 <p class="account-msg" id="resend-msg" hidden></p>`}
          ` : `
            <p class="account-help">
              Add an email and password so you can sign in without Discord.
              This doesn't remove Discord — you'll be able to use either.
            </p>
            <form id="link-form" class="account-form">
              <label class="account-label" for="link-email">Email</label>
              <input class="account-input" id="link-email" type="email" required
                     autocomplete="email" spellcheck="false">

              <label class="account-label" for="link-password">Password</label>
              <input class="account-input" id="link-password" type="password" required
                     minlength="8" autocomplete="new-password">
              <p class="account-help">At least 8 characters.</p>

              <p class="account-error" id="link-error" hidden></p>
              <button class="account-btn" type="submit" id="link-btn">Add email</button>
            </form>
          `}
        </section>

        <section class="account-card">
          <h3>Discord</h3>
          <p class="${methods.discord ? 'account-ok' : 'account-help'}">
            ${methods.discord ? 'Linked' : 'Not linked'}
          </p>
        </section>
      </div>`;

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
