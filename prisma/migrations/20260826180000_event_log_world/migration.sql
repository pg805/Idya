-- Make EventLog able to record things that happen somewhere (docs/world.md §3).
--
-- Additive: five nullable columns and four indexes. Existing rows read as
-- events with no location, which is what they are.
--
-- Columns rather than payload keys because a square has to be queryable:
-- digging every event at a tile out of JSON works right up until it matters.
ALTER TABLE "EventLog" ADD COLUMN "character_id" TEXT;
ALTER TABLE "EventLog" ADD COLUMN "chunk_x" INTEGER;
ALTER TABLE "EventLog" ADD COLUMN "chunk_y" INTEGER;
ALTER TABLE "EventLog" ADD COLUMN "tile_x" INTEGER;
ALTER TABLE "EventLog" ADD COLUMN "tile_y" INTEGER;

-- The four questions worth asking of a log: what happened lately, what did this
-- account do, what happened in this place, and what happened of this kind.
CREATE INDEX "EventLog_created_at_idx" ON "EventLog"("created_at");
CREATE INDEX "EventLog_discord_id_created_at_idx" ON "EventLog"("discord_id", "created_at");
CREATE INDEX "EventLog_chunk_x_chunk_y_created_at_idx" ON "EventLog"("chunk_x", "chunk_y", "created_at");
CREATE INDEX "EventLog_event_type_created_at_idx" ON "EventLog"("event_type", "created_at");
