import { createHash, randomBytes } from 'node:crypto';

/**
 * Password-reset tokens.
 *
 * The database stores a SHA-256 of the token, never the token itself, so a
 * leaked database can't be used to reset anyone's password — the same reasoning
 * as hashing the password. Plain SHA-256 is right here (unlike for passwords)
 * because the token is 32 random bytes: there's no dictionary to run against it,
 * so a slow hash would only cost us time on every verification.
 */

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
// Longer than a reset: there's no urgency, and people check mail on their own
// schedule. Short enough that a stale link in an old inbox isn't useful.
export const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** The token goes in the email; the hash goes in the database. */
export function newResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resetEmail(link: string, ttlMinutes = RESET_TTL_MS / 60000): { subject: string; text: string; html: string } {
  const subject = 'Reset your Legacy of Apolis password';
  const text =
    `Someone asked to reset the password for this Legacy of Apolis account.\n\n` +
    `${link}\n\n` +
    `The link works once and expires in ${ttlMinutes} minutes.\n` +
    `If this wasn't you, ignore this email — nothing has changed.\n`;

  // Inline styles and a plain layout: email clients strip <style> blocks and
  // most of CSS, so anything clever here would arrive broken.
  const html =
    `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.5;color:#1d2b53">` +
    `<p>Someone asked to reset the password for this Legacy of Apolis account.</p>` +
    `<p><a href="${escapeAttr(link)}" style="display:inline-block;padding:10px 20px;background:#1d2b53;color:#f2cb4d;text-decoration:none">Reset password</a></p>` +
    `<p style="color:#686868">The link works once and expires in ${ttlMinutes} minutes.<br>` +
    `If this wasn't you, ignore this email — nothing has changed.</p>` +
    `<p style="color:#686868;font-size:12px">${escapeAttr(link)}</p>` +
    `</div>`;

  return { subject, text, html };
}

export function verificationEmail(link: string): { subject: string; text: string; html: string } {
  const subject = 'Confirm your email for Legacy of Apolis';
  const text =
    `Confirm this address so you can recover your Legacy of Apolis account if you ` +
    `ever lose your password.\n\n` +
    `${link}\n\n` +
    `The link works once and expires in 7 days.\n` +
    `If you didn't sign up, ignore this email — no account will be created for you.\n`;

  const html =
    `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.5;color:#1d2b53">` +
    `<p>Confirm this address so you can recover your Legacy of Apolis account if you ever lose your password.</p>` +
    `<p><a href="${escapeAttr(link)}" style="display:inline-block;padding:10px 20px;background:#1d2b53;color:#f2cb4d;text-decoration:none">Confirm email</a></p>` +
    `<p style="color:#686868">The link works once and expires in 7 days.<br>` +
    `If you didn't sign up, ignore this email — no account will be created for you.</p>` +
    `<p style="color:#686868;font-size:12px">${escapeAttr(link)}</p>` +
    `</div>`;

  return { subject, text, html };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
