-- Placeable world objects, and room in WorldTile for more than one kind of
-- ground change (docs/world.md §3).
--
-- WorldTile is empty, so its key can be widened outright rather than migrated.
-- `kind` has to be part of it: 'corner' addresses the CORNER lattice, which is
-- one wider and taller than the board and is where ground material actually
-- lives, while 'cleared' addresses a square whose obstacle has been felled.
-- The same numbers mean different places to each, so without kind in the key
-- they collide.
ALTER TABLE "WorldTile" DROP CONSTRAINT "WorldTile_pkey";
ALTER TABLE "WorldTile" ADD CONSTRAINT "WorldTile_pkey"
    PRIMARY KEY ("chunk_x", "chunk_y", "tile_x", "tile_y", "kind");

-- Things standing on the world. Not part of the authored art: the town is built
-- by placing these at runtime, so a building can appear the moment somebody buys
-- one rather than when the map is redrawn.
CREATE TABLE "WorldObject" (
    "id" TEXT NOT NULL,
    "chunk_x" INTEGER NOT NULL,
    "chunk_y" INTEGER NOT NULL,
    "tile_x" INTEGER NOT NULL,
    "tile_y" INTEGER NOT NULL,
    -- Atlas name of what to draw. Swapping it is how a thing changes
    -- appearance: an unlit fire becomes a lit one.
    "sprite" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'decor',
    "state" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "owner_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldObject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorldObject_chunk_x_chunk_y_idx" ON "WorldObject"("chunk_x", "chunk_y");
CREATE INDEX "WorldObject_owner_account_id_idx" ON "WorldObject"("owner_account_id");
