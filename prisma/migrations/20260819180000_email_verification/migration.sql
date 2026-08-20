-- Email verification (docs/world.md §1).
--
-- Additive: one new column and one new table. Nothing existing is altered or
-- dropped, and the new column is nullable, so existing credentials simply read
-- as unverified.

-- Null until the address is confirmed. This gates trusting the address, not
-- access to the game — an unverified account can still play.
ALTER TABLE "EmailCredential" ADD COLUMN "verified_at" TIMESTAMP(3);

-- Same shape and reasoning as PasswordReset: only a SHA-256 of the emailed
-- token is stored, single use, short-lived. Kept as its own table so neither
-- flow can spend the other's token.
CREATE TABLE "EmailVerification" (
    "token_hash" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("token_hash")
);

CREATE INDEX "EmailVerification_account_id_idx" ON "EmailVerification"("account_id");
