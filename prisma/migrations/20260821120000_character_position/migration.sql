-- Where a character is standing in the world (docs/world.md §3).
--
-- Additive: four columns with defaults, so every existing character simply
-- starts in Sulku'it near the middle of the field.
--
-- Position lives on Character rather than in its own table because it is 1:1
-- and read on nearly every world request; a join would buy nothing.
ALTER TABLE "Character" ADD COLUMN "chunk_x" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "chunk_y" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "tile_x" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "Character" ADD COLUMN "tile_y" INTEGER NOT NULL DEFAULT 12;
