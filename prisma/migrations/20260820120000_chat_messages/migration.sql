-- In-character, location-scoped chat (docs/world.md §2).
--
-- Additive: one new table.
--
-- Location is a chunk coordinate from the start, not a named zone, so nothing
-- has to migrate when the world map lands. Sulku'it is (0,0); everywhere else
-- radiates out from it.
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "chunk_x" INTEGER NOT NULL,
    "chunk_y" INTEGER NOT NULL,
    "account_id" TEXT NOT NULL,
    "character_id" TEXT,
    -- Denormalized: a log should read as what somebody was called when they
    -- said it, and history shouldn't need a join against a character that may
    -- since have been renamed or deleted.
    "character_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- GM moderation hides rather than deletes, so the record survives.
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- The read path: everything said in one place, newest last.
CREATE INDEX "ChatMessage_chunk_x_chunk_y_created_at_idx"
    ON "ChatMessage"("chunk_x", "chunk_y", "created_at");

-- For moderation and for anything that needs one account's history.
CREATE INDEX "ChatMessage_account_id_idx" ON "ChatMessage"("account_id");
