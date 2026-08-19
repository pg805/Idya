import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// scrypt rather than bcrypt/argon2 so there's no native dependency to build on
// deploy. These are the Node defaults' cost, which is a reasonable interactive
// target; raising N is the knob if it ever needs to be slower.
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

/** "salt:hash", both hex. Everything needed to verify travels with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, PARAMS);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, 'hex');
  } catch { return false; }
  if (expected.length !== KEYLEN) return false;

  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEYLEN, PARAMS);
  return timingSafeEqual(actual, expected);
}

/**
 * Why a password is rejected, or null if it's fine.
 *
 * Length only. Composition rules (a digit, a symbol, a capital) push people
 * toward `Password1!` and are worse than a longer passphrase, so the floor is
 * 10 characters and nothing else.
 */
export function passwordProblem(password: string): string | null {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters.';
  }
  if (password.length > 200) return 'Password must be under 200 characters.';
  return null;
}

/**
 * Deliberately permissive: anything with an @ and a dot after it. Strict email
 * regexes reject valid addresses, and the only real proof is sending mail —
 * which needs a provider we don't have configured yet.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
