-- Add version + weapon_key columns so the dev stats page can filter battles
-- by release version and by which weapon the player was using. Both nullable
-- so existing pre-0.2.0 rows don't need backfill (they'll show up under the
-- "pre-0.2.0" / "unknown weapon" group in the filter UI).
ALTER TABLE "BattleLog" ADD COLUMN "version" TEXT;
ALTER TABLE "BattleLog" ADD COLUMN "weapon_key" TEXT;
