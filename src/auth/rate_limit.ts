/**
 * A small fixed-window limiter for the auth endpoints.
 *
 * Sign-in had no throttle at all, so guessing was only as slow as scrypt made
 * it (~100ms an attempt). That's real protection but it isn't a limit — this
 * is. In-memory and per-process, which is fine for one server and resets on
 * deploy; if that ever stops being true it moves behind the same interface.
 *
 * Keyed by whatever the caller passes (IP, or IP + email) so a shared address
 * can't lock out a whole household on one typo'd password.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. Only meaningful when blocked. */
  retryAfter: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    this.sweep(now);
    const entry = this.hits.get(key);

    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  /** Forget a key — call after a success so one good login clears the count. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  // Cheap enough to do inline; the map only holds keys seen this window.
  private sweep(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) {
      if (now >= entry.resetAt) this.hits.delete(key);
    }
  }
}

/** Best-effort client address, honouring the proxy header the deploy sits behind. */
export function clientIp(headers: Record<string, unknown>, fallback?: string): string {
  const fwd = headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof raw === 'string' && raw.length > 0) return raw.split(',')[0].trim();
  return fallback ?? 'unknown';
}
