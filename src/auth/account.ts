/**
 * The internal identity of a player.
 *
 * An AccountId is deliberately OPAQUE. It is not a Discord snowflake, not an
 * email, not any third party's identifier — even though today every existing
 * account's id happens to *be* the Discord id it was created from (see
 * `identity_directory.ts` for why that's safe, and why it's temporary).
 *
 * Nothing outside `src/auth/` should assume an AccountId means anything. If you
 * find yourself passing one to Discord, or parsing it, you want an Identity
 * (provider + provider_user_id) instead.
 *
 * See docs/world.md §1.
 */
export type AccountId = string;

/** An external login that resolves to an account. */
export type Provider = 'discord' | 'google' | 'email';

export interface Identity {
  provider: Provider;
  /** The id this provider knows the user by. */
  providerUserId: string;
}

export const identityKey = (i: Identity): string => `${i.provider}:${i.providerUserId}`;
