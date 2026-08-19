import { AccountId, Identity, Provider } from './account.js';

/**
 * Maps external logins onto internal accounts.
 *
 * The point of this indirection is that a player is not "a Discord user" — they
 * are an account that currently *has* a Discord identity, and may later have a
 * Google one, an email one, or several at once. See docs/world.md §1.
 *
 * Backed by a real `Identity` table once the migration lands. Until then the
 * grandfathered implementation below preserves today's behaviour exactly.
 */
export interface IdentityDirectory {
  /** The account this login belongs to, or null if it's an unknown login. */
  resolve(identity: Identity): Promise<AccountId | null>;
  /** Attach a login to an account. */
  link(identity: Identity, account: AccountId): Promise<void>;
}

/**
 * The transitional directory: every existing account's id IS the Discord id it
 * was created from, so resolving a Discord identity is the identity function.
 *
 * That equality is a historical accident we're keeping only until the migration
 * — it is NOT something callers may rely on, which is exactly why they now go
 * through here instead of using a Discord id directly. When the migration runs,
 * this class is replaced by a table lookup and every call site keeps working.
 *
 * Non-Discord providers deliberately return null rather than inventing an
 * account: there is nowhere to persist the mapping yet, and silently minting
 * accounts that vanish on restart would be worse than refusing the login.
 */
export class GrandfatheredDirectory implements IdentityDirectory {
  async resolve(identity: Identity): Promise<AccountId | null> {
    return identity.provider === 'discord' ? identity.providerUserId : null;
  }

  async link(identity: Identity, account: AccountId): Promise<void> {
    if (identity.provider === 'discord' && identity.providerUserId === account) return;
    throw new Error(
      `Cannot link ${identity.provider} identities until the Identity table exists ` +
      `(docs/world.md §1, phase 0).`
    );
  }
}

/**
 * The real directory, backed by the Identity table.
 *
 * Discord accounts predate the table, so a Discord identity that isn't in it yet
 * still resolves to itself (the account id *is* the snowflake for those users)
 * and gets written back on the way past. That backfills the table from live
 * traffic instead of a bulk UPDATE, so no migration has to touch existing rows.
 * Once every active player has signed in once, the fallback is dead code.
 */
export class PrismaIdentityDirectory implements IdentityDirectory {
  constructor(private readonly db: PrismaLike) {}

  async resolve(identity: Identity): Promise<AccountId | null> {
    const row = await this.db.identity.findUnique({
      where: { provider_provider_user_id: {
        provider: identity.provider, provider_user_id: identity.providerUserId,
      } },
    });
    if (row) return row.account_id;

    if (identity.provider !== 'discord') return null;

    // Grandfathered: only claim it if that account actually exists, so a
    // made-up snowflake doesn't mint an identity for a nonexistent user.
    const user = await this.db.user.findUnique({ where: { discord_id: identity.providerUserId } });
    if (!user) return null;
    await this.link(identity, identity.providerUserId);
    return identity.providerUserId;
  }

  async link(identity: Identity, account: AccountId): Promise<void> {
    await this.db.identity.upsert({
      where: { provider_provider_user_id: {
        provider: identity.provider, provider_user_id: identity.providerUserId,
      } },
      update: {},
      create: {
        provider: identity.provider,
        provider_user_id: identity.providerUserId,
        account_id: account,
      },
    });
  }
}

/** The slice of the Prisma client this needs — keeps the import out of here. */
interface PrismaLike {
  identity: {
    findUnique(args: unknown): Promise<{ account_id: string } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
  user: {
    findUnique(args: unknown): Promise<unknown | null>;
  };
}

/** Convenience constructors for the providers in play. */
export const discordIdentity = (providerUserId: string): Identity =>
  ({ provider: 'discord' as Provider, providerUserId });

export const emailIdentity = (email: string): Identity =>
  ({ provider: 'email' as Provider, providerUserId: email.toLowerCase() });
