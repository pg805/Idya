// Test accounts for playtesting. Dev only, and enforced rather than trusted.
//
//   node lib/tools/seed_test_accounts.js            # create / reset the set
//   node lib/tools/seed_test_accounts.js --remove   # sweep them
//
// These are NOT a login backdoor. Nothing is added to the server's auth
// surface: the rows written here are ordinary User + EmailCredential +
// Identity rows, exactly what /api/auth/signup writes, and they sign in
// through the normal form. The only thing "test" about them is where they are
// allowed to exist, which is what the two gates below are for.
//
// Gate 1 is NODE_ENV. Gate 2 is the database name, and it is the one that
// matters: a flag describes intent, but the database name IS the data, so a
// prod URL is refused even if the environment lies about itself.
//
// The addresses sit on `.test`, reserved by RFC 2606 and guaranteed never to
// resolve. That is deliberate and load-bearing: these accounts can never
// receive a verification link or a password reset, so the only way in is the
// password printed below. Email verification does not gate play (world.md §1),
// so an address that can never receive mail costs nothing.
import prisma from '../database/prisma.js';
import { hashPassword, passwordProblem, normalizeEmail } from '../auth/password.js';

// Fixed account ids so a re-run updates the same rows instead of orphaning the
// old ones. Real signups get a randomUUID; these are deliberately legible, so
// a test account is obvious at a glance in the database.
const ACCOUNTS = [
  { id: 'test-0000-0000-0000-000000000001', email: 'player1@idya.test', password: 'swallow-grove-11' },
  { id: 'test-0000-0000-0000-000000000002', email: 'player2@idya.test', password: 'sulfolk-anvil-22' },
  { id: 'test-0000-0000-0000-000000000003', email: 'player3@idya.test', password: 'maetoad-hollow-33' },
  { id: 'test-0000-0000-0000-000000000004', email: 'player4@idya.test', password: 'golnosar-quarry-44' },
];

// The database name out of DATABASE_URL, or null if it can't be read. Null is
// treated as a refusal: an unreadable URL is not a URL known to be safe.
function databaseName(): string | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    // The value is often quoted in .env, and the path is /<dbname>.
    const url = new URL(raw.replace(/^["']|["']$/g, ''));
    const name = url.pathname.replace(/^\//, '');
    return name || null;
  } catch {
    return null;
  }
}

function refuse(why: string): never {
  console.error(`REFUSED: ${why}`);
  console.error('Test accounts may only be written to a development database.');
  process.exit(1);
}

function assertDevEnvironment(): string {
  if (process.env.NODE_ENV === 'production') refuse('NODE_ENV is "production".');

  const db = databaseName();
  if (!db) refuse('DATABASE_URL is missing or unparseable, so the target is unknown.');
  // Allowlist by shape, not a denylist of prod names: a new prod database
  // added later is refused by default rather than silently permitted.
  if (!/(^|_)dev$/.test(db) && !/^idya_test/.test(db)) {
    refuse(`database "${db}" is not a development database (expected a *_dev or idya_test* name).`);
  }
  return db;
}

async function seed(): Promise<void> {
  for (const acct of ACCOUNTS) {
    const email = normalizeEmail(acct.email);
    if (!email) throw new Error(`bad test email: ${acct.email}`);
    // Run the real validator. If the rules tighten, these fail loudly here
    // rather than producing accounts nobody can recreate through signup.
    const problem = passwordProblem(acct.password, email);
    if (problem) throw new Error(`test password for ${email} rejected: ${problem}`);

    const password_hash = await hashPassword(acct.password);

    await prisma.$transaction([
      prisma.user.upsert({
        where:  { discord_id: acct.id },
        update: {},
        create: { discord_id: acct.id },
      }),
      prisma.emailCredential.upsert({
        where:  { account_id: acct.id },
        update: { email, password_hash },
        create: { account_id: acct.id, email, password_hash },
      }),
      prisma.identity.upsert({
        where:  { provider_provider_user_id: { provider: 'email', provider_user_id: email } },
        update: { account_id: acct.id },
        create: { provider: 'email', provider_user_id: email, account_id: acct.id },
      }),
    ]);

    const chars = await prisma.character.count({ where: { discord_id: acct.id } });
    console.log(`  ${email.padEnd(22)} ${acct.password.padEnd(20)} ${chars ? `${chars} character(s)` : 'no character yet'}`);
  }
}

async function remove(): Promise<void> {
  for (const acct of ACCOUNTS) {
    const chars = await prisma.character.count({ where: { discord_id: acct.id } });
    if (chars > 0) {
      // Characters carry inventory, weapons and professions by relation.
      // Deleting them here would be a wider blast radius than this tool should
      // have, so say so and let the caller decide.
      console.log(`  ${acct.email.padEnd(22)} SKIPPED — has ${chars} character(s); delete those first`);
      continue;
    }
    await prisma.$transaction([
      prisma.identity.deleteMany({ where: { account_id: acct.id } }),
      prisma.emailCredential.deleteMany({ where: { account_id: acct.id } }),
      prisma.user.deleteMany({ where: { discord_id: acct.id } }),
    ]);
    console.log(`  ${acct.email.padEnd(22)} removed`);
  }
}

async function main(): Promise<void> {
  const db = assertDevEnvironment();
  const removing = process.argv.includes('--remove');
  console.log(`${removing ? 'Removing' : 'Seeding'} ${ACCOUNTS.length} test accounts in "${db}".\n`);
  if (removing) await remove();
  else await seed();
  console.log(removing ? '\nDone.' : '\nDone. Sign in at /signin — no verification needed.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
