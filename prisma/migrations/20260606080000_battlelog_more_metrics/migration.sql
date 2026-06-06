-- More per-battle metrics: enemy HP left, crit count, aimed hit rate inputs,
-- resource restores, and which side rolled higher initiative. All nullable
-- for legacy rows.
ALTER TABLE "BattleLog" ADD COLUMN "enemy_hp_left"     INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "crit_count"        INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "aimed_attempted"   INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "aimed_hit"         INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "restores"          INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "player_went_first" BOOLEAN;
