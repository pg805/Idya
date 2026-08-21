-- Sparse world changes (docs/world.md §3).
--
-- Additive: one new table.
--
-- The world's ground is never stored. A chunk is generated from
-- hash(worldSeed, x, y), so the same coordinate always produces the same place,
-- and only what players changed needs saving. A felled tree is one row here;
-- the forest around it is nothing at all.
CREATE TABLE "WorldTile" (
    "chunk_x" INTEGER NOT NULL,
    "chunk_y" INTEGER NOT NULL,
    "tile_x" INTEGER NOT NULL,
    "tile_y" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    -- Loose on purpose: the vocabulary of world changes is still being found.
    "data" JSONB NOT NULL DEFAULT '{}',
    "account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldTile_pkey" PRIMARY KEY ("chunk_x", "chunk_y", "tile_x", "tile_y")
);

-- The read path: every change in one chunk, fetched when it loads.
CREATE INDEX "WorldTile_chunk_x_chunk_y_idx" ON "WorldTile"("chunk_x", "chunk_y");
