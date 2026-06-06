-- Per-battle combat metrics for the dev stats page.
-- Multi-enemy battles write one row per enemy; player-side numbers
-- (hp_left, damage_received, rounds_count) repeat across those rows.
ALTER TABLE "BattleLog" ADD COLUMN "player_hp_left"  INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "damage_dealt"    INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "damage_received" INTEGER;
ALTER TABLE "BattleLog" ADD COLUMN "rounds_count"    INTEGER;
