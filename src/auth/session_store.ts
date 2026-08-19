import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AccountId } from './account.js';

/**
 * Issues and validates the tokens that keep a player logged in.
 *
 * Split out from `server/index.ts` so the backing store is swappable: today it
 * is either in-process memory (what shipped) or stateless signed tokens (what
 * survives a deploy). A database-backed `Session` table drops in behind the same
 * interface later without touching a single call site. See docs/world.md §1.
 */
export interface SessionStore {
  /** Mint a token for this account. Safe to call repeatedly. */
  issue(account: AccountId): string;
  /** The account this token belongs to, or null if it's invalid or expired. */
  resolve(token: string): AccountId | null;
  /** Invalidate a token. */
  revoke(token: string): void;
  /** Human-readable description of the backing store, for the boot log. */
  readonly description: string;
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Cryptographically random, unlike the Math.random() tokens this replaces. */
const randomToken = (): string => randomBytes(24).toString('base64url');

/**
 * The original behaviour: tokens live in a Map and die with the process.
 *
 * Every deploy logs out every player, which is why this is now the *fallback*
 * rather than the only option. Kept because it needs no configuration.
 */
export class MemorySessionStore implements SessionStore {
  readonly description = 'in-memory (sessions are lost on restart)';

  private readonly byToken = new Map<string, AccountId>();
  private readonly byAccount = new Map<AccountId, string>();

  issue(account: AccountId): string {
    // Reuse an account's existing token across visits, as the original did —
    // links handed out by the bot stay valid for the life of the process.
    const existing = this.byAccount.get(account);
    if (existing) return existing;

    const token = randomToken();
    this.byToken.set(token, account);
    this.byAccount.set(account, token);
    return token;
  }

  resolve(token: string): AccountId | null {
    return this.byToken.get(token) ?? null;
  }

  revoke(token: string): void {
    const account = this.byToken.get(token);
    if (account === undefined) return;
    this.byToken.delete(token);
    if (this.byAccount.get(account) === token) this.byAccount.delete(account);
  }
}

/**
 * Stateless signed tokens: `v1.<payload>.<hmac>`.
 *
 * The account id and expiry travel inside the token, signed with a secret that
 * outlives the process — so a restart doesn't log anyone out, with no table and
 * no migration. That's the whole reason this exists ahead of the DB work.
 *
 * Trade-off: a token can't be individually revoked before it expires, because
 * there's nothing to delete. `revoke` keeps an in-process denylist, which is
 * enough for logout in a running server but is forgotten on restart. When the
 * `Session` table lands, real revocation comes with it.
 */
export class SignedSessionStore implements SessionStore {
  readonly description = 'signed tokens (survive restart)';

  private readonly revoked = new Set<string>();

  constructor(private readonly secret: string, private readonly ttlMs = TOKEN_TTL_MS) {}

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  issue(account: AccountId): string {
    const payload = Buffer
      .from(JSON.stringify({ a: account, e: Date.now() + this.ttlMs }))
      .toString('base64url');
    return `v1.${payload}.${this.sign(payload)}`;
  }

  resolve(token: string): AccountId | null {
    if (this.revoked.has(token)) return null;

    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, payload, signature] = parts;

    const expected = this.sign(payload);
    // Constant-time compare; timingSafeEqual throws on a length mismatch.
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

    try {
      const { a, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as
        { a?: unknown; e?: unknown };
      if (typeof a !== 'string' || typeof e !== 'number') return null;
      if (Date.now() > e) return null;
      return a;
    } catch {
      return null;
    }
  }

  revoke(token: string): void {
    this.revoked.add(token);
  }
}

/**
 * Picks a store from the environment.
 *
 * Set `IDYA_SESSION_SECRET` to stop deploys logging everyone out. Without it we
 * fall back to the old in-memory behaviour rather than inventing a secret at
 * boot — a per-process secret would expire every session on restart anyway, so
 * it would be the same bug wearing a disguise.
 */
export function createSessionStore(env: NodeJS.ProcessEnv = process.env): SessionStore {
  const secret = env.IDYA_SESSION_SECRET?.trim();
  return secret ? new SignedSessionStore(secret) : new MemorySessionStore();
}
