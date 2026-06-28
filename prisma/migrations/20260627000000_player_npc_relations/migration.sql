-- Per-character lean (empire / town / neutral), chosen at creation; gates NPC
-- dialogue. Existing characters default to neutral.
ALTER TABLE "Character" ADD COLUMN "faction" TEXT NOT NULL DEFAULT 'neutral';

-- Player <-> NPC relationship: opinion (warmth) + familiarity + shared flags.
-- Standing (the friendship tier) is derived at read time, not stored.
CREATE TABLE "PlayerNpcRelation" (
    "character_id" TEXT NOT NULL,
    "npc_id" TEXT NOT NULL,
    "met_before" BOOLEAN NOT NULL DEFAULT false,
    "familiarity" INTEGER NOT NULL DEFAULT 0,
    "opinion" INTEGER NOT NULL DEFAULT 5,
    "shared_history" JSONB NOT NULL DEFAULT '[]',
    "last_spoken_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerNpcRelation_pkey" PRIMARY KEY ("character_id","npc_id")
);

ALTER TABLE "PlayerNpcRelation" ADD CONSTRAINT "PlayerNpcRelation_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
