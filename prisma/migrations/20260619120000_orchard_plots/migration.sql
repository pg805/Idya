-- Lumberjack orchard: one plot row per (character, slot). A plot multiplies a
-- planted item over 4h ticks (capped at 24h / 6 ticks); the seed is spent on
-- plant and `accrued` banks the rolled output until harvest. Idle plot: item_id NULL.
CREATE TABLE "OrchardPlot" (
    "character_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "item_id" TEXT,
    "seed_count" INTEGER NOT NULL DEFAULT 0,
    "accrued" INTEGER NOT NULL DEFAULT 0,
    "ticks_banked" INTEGER NOT NULL DEFAULT 0,
    "last_tick_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrchardPlot_pkey" PRIMARY KEY ("character_id","slot")
);

ALTER TABLE "OrchardPlot" ADD CONSTRAINT "OrchardPlot_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
