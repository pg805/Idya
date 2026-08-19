/**
 * Transactional email via Resend.
 *
 * Plain HTTPS POST rather than their SDK — one endpoint doesn't justify a
 * dependency, and it matches how the Cloudflare purge in deploy-prod.sh already
 * talks to an API.
 *
 * With no RESEND_API_KEY configured this logs the message instead of sending.
 * That keeps local runs and any un-keyed environment working, and means a
 * missing key degrades to "the link is in the server log" rather than a crash
 * or, worse, a silent success that never arrives.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<{ ok: boolean; error?: string }>;
  readonly description: string;
}

class ResendMailer implements Mailer {
  readonly description: string;

  constructor(private readonly apiKey: string, private readonly from: string) {
    this.description = `Resend (from ${from})`;
  }

  async send(mail: Mail): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
      });

      if (res.ok) return { ok: true };

      // Resend puts the useful part in the body; the status alone won't say
      // whether it's an unverified domain, a bad key, or a malformed address.
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json() as { message?: string; name?: string };
        if (body?.message) detail = `${body.name ?? res.status}: ${body.message}`;
      } catch { /* keep the status */ }
      return { ok: false, error: detail };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'network error' };
    }
  }
}

class ConsoleMailer implements Mailer {
  readonly description = 'console (no RESEND_API_KEY — mail is logged, not sent)';

  async send(mail: Mail): Promise<{ ok: boolean }> {
    console.log(
      `\n--- email not sent (no RESEND_API_KEY) ---\n` +
      `to:      ${mail.to}\n` +
      `subject: ${mail.subject}\n` +
      `${mail.text}\n` +
      `-----------------------------------------\n`,
    );
    return { ok: true };
  }
}

export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const key = env.RESEND_API_KEY?.trim();
  // Must be on a domain verified with Resend, or every send is rejected.
  const from = env.MAIL_FROM?.trim() || 'Legacy of Apolis <noreply@idya.slowb.rodeo>';
  return key ? new ResendMailer(key, from) : new ConsoleMailer();
}
