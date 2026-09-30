-- Containers in the world hold things.
--
-- Purely additive: a new table and nothing touched. Chests already exist as
-- WorldObject rows with the obj_chest_01 sprite; this gives them contents.
--
-- Slots rather than a quantity map, which is the difference from InventoryItem.
-- A chest is a GRID somebody arranges, so where a stack sits is a decision the
-- player made; collapsing it to "item -> count" would reshuffle their chest
-- every time they opened it. A bag has no order and a chest does.
--
-- A row exists only for an occupied slot, so an empty chest is no rows at all.
CREATE TABLE "ChestSlot" (
    "object_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ChestSlot_pkey" PRIMARY KEY ("object_id","slot")
);

CREATE INDEX "ChestSlot_object_id_idx" ON "ChestSlot"("object_id");

-- Cascades: destroying the chest destroys what was in it. That is the honest
-- behaviour for a thing in the world, and it stops orphan rows accumulating
-- every time a GM clears a square.
ALTER TABLE "ChestSlot" ADD CONSTRAINT "ChestSlot_object_id_fkey"
    FOREIGN KEY ("object_id") REFERENCES "WorldObject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict rather than cascade: an item definition disappearing while stock of
-- it sits in a chest is a data problem to notice, not one to silently tidy.
ALTER TABLE "ChestSlot" ADD CONSTRAINT "ChestSlot_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "Item"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
