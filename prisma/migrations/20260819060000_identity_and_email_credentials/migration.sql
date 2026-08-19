-- Phase 0 of the Discord divorce (docs/world.md §1).
--
-- Purely additive: two new tables, nothing existing is altered or dropped. The
-- account id is still User.discord_id — renaming that column is a separate step,
-- and this migration deliberately does not touch it.

-- An external login mapped onto an account. Discord users are backfilled here
-- lazily on their next sign-in rather than in a bulk UPDATE, so this migration
-- stays a pure schema change and can't misfire on live rows.
CREATE TABLE "Identity" (
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("provider","provider_user_id")
);

CREATE INDEX "Identity_account_id_idx" ON "Identity"("account_id");

-- Email + password sign-in. Only this provider holds a secret, so it lives
-- apart from Identity. password_hash is scrypt, stored as "salt:hash" in hex.
CREATE TABLE "EmailCredential" (
    "account_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCredential_pkey" PRIMARY KEY ("account_id")
);

-- Emails are stored lowercased, so this uniqueness is case-insensitive in effect.
CREATE UNIQUE INDEX "EmailCredential_email_key" ON "EmailCredential"("email");
