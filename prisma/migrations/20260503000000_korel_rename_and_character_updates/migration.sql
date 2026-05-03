ALTER TABLE "User" RENAME COLUMN "currency" TO "korel";
ALTER TABLE "User" ADD COLUMN "tutorial_complete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Character" ADD COLUMN "sprite_token" TEXT;
ALTER TABLE "Character" DROP COLUMN IF EXISTS "image";
