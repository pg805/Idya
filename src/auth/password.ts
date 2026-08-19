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

export const MIN_PASSWORD_LENGTH = 8;

/**
 * The passwords people actually pick, which are what actually get guessed.
 *
 * Rejecting these buys far more than demanding a 9th and 10th character:
 * the real attacks are dictionary and credential-stuffing runs, not brute
 * force across the keyspace. Deliberately short and hand-kept rather than a
 * bundled 10k-entry list — these plus the structural checks below cover the
 * overwhelming majority of bad choices at no size cost.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', '1234567890', '12341234', '11111111',
  '00000000', '87654321', '1qaz2wsx', 'qwertyui', 'qwerty123', 'qwertyuiop',
  'asdfghjkl', 'zxcvbnm1', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', 'abcd1234',
  'abc12345', 'a1b2c3d4', 'iloveyou', 'princess', 'sunshine', 'football',
  'baseball', 'trustno1', 'superman', 'batman123', 'starwars', 'pokemon1',
  'dragon123', 'monkey123', 'letmein1', 'letmein123', 'welcome1', 'welcome123',
  'admin123', 'administrator', 'changeme', 'secret123', 'whatever', 'freedom1',
  'computer', 'internet', 'michael1', 'jennifer', 'jordan23', 'chocolate',
  'butterfly', 'shadow123', 'master123', 'access123', 'flower123', 'hunter22',
  'thomas123', 'robert123', 'matthew1', 'daniel123', 'charlie1', 'michelle',
]);

/**
 * Why a password is rejected, or null if it's fine.
 *
 * Eight characters, matching NIST SP 800-63B. No composition rules — demanding
 * a digit and a symbol reliably produces `Password1!`, which is weaker than a
 * few plain words. What's checked instead is whether it's a password someone
 * would guess.
 *
 * `email` is optional so the check can also refuse an address-derived password.
 */
export function passwordProblem(password: unknown, email?: string | null): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return 'Password must be under 200 characters.';

  const lower = password.toLowerCase();

  if (COMMON.has(lower)) {
    return 'That password is one of the most commonly used. Pick something else.';
  }
  // "aaaaaaaa", "11111111"
  if (/^(.)\1+$/.test(password)) {
    return 'That password is just one repeated character.';
  }
  // Runs like "abcdefgh" / "12345678", forwards or backwards.
  if (isSequential(lower)) {
    return 'That password is a straight run of characters. Pick something else.';
  }
  // "mac@example.com" -> refuse "mac", "macmacmac", "mac1234"...
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) {
    return 'Password should not contain your email address.';
  }
  if (lower.includes('apolis') || lower.includes('idya')) {
    return "Password should not be the game's name.";
  }
  return null;
}

function isSequential(s: string): boolean {
  if (s.length < 4) return false;
  let up = true, down = true;
  for (let i = 1; i < s.length; i++) {
    const step = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (step !== 1) up = false;
    if (step !== -1) down = false;
    if (!up && !down) return false;
  }
  return true;
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
