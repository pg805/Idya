-- Player upgrade count on the equipped weapon at battle time (each upgrade = +1;
-- 3 = a weapon level), so the dev stats page can split a weapon by effective
-- level. Nullable for rows logged before this was tracked.
ALTER TABLE "BattleLog" ADD COLUMN "weapon_upgrades" INTEGER;
