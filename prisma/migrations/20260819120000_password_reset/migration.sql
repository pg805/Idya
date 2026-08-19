-- Password reset tokens (docs/world.md §1).
--
-- Additive: one new table, nothing existing is altered.
--
-- token_hash is a SHA-256 of the token that was emailed; the token itself is
-- never stored, so a leaked database cannot be used to reset a password. Rows
-- are single-use (used_at) and short-lived (expires_at).
CREATE TABLE "PasswordReset" (
    "token_hash" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("token_hash")
);

-- Used to invalidate an account's other outstanding tokens when one is spent.
CREATE INDEX "PasswordReset_account_id_idx" ON "PasswordReset"("account_id");
