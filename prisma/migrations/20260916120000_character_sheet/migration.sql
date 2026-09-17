-- Character sheets: the prose, the declared stances, canon status, and goals.
--
-- Additive throughout. Every existing character keeps playing: the new columns
-- are nullable or defaulted, and canon_status defaults to 'draft', which is
-- exactly what an existing character is. Nothing here gates play (world.md 11):
-- approval grants standing, not access.
ALTER TABLE "Character" ADD COLUMN "physical" TEXT;
ALTER TABLE "Character" ADD COLUMN "relationships" TEXT;

-- What the character SAYS about the five forces, { forceKey: stance }. Standing,
-- which is earned in play and gates access, is a different thing and gets its
-- own table when it exists.
ALTER TABLE "Character" ADD COLUMN "force_stances" JSONB NOT NULL DEFAULT '{}';

-- draft -> submitted -> canon. The GM alone moves it to canon.
ALTER TABLE "Character" ADD COLUMN "canon_status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "Character" ADD COLUMN "canon_submitted_at" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "canon_reviewed_at" TIMESTAMP(3);

-- What a character is here to do. Each kind is a gameplay feature rather than
-- flavour, so a goal can be accomplished and replaced. 'own_path' is the
-- exception: free text is a proposal for the GM, not a goal the world tracks.
CREATE TABLE "CharacterGoal" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    -- 'build' | 'debt' | 'serve' | 'master' | 'buried' | 'magic' | 'own_path'
    "kind" TEXT NOT NULL,
    -- home/shop, money/vengeance, a force key, a profession key, an item key,
    -- spell/enchantment. Null for own_path.
    "variant" TEXT,
    "detail" TEXT,
    -- 'active' | 'accomplished' | 'abandoned', or 'proposed' for own_path.
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accomplished_at" TIMESTAMP(3),

    CONSTRAINT "CharacterGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CharacterGoal_character_id_idx" ON "CharacterGoal"("character_id");
CREATE INDEX "CharacterGoal_status_idx" ON "CharacterGoal"("status");

ALTER TABLE "CharacterGoal" ADD CONSTRAINT "CharacterGoal_character_id_fkey"
    FOREIGN KEY ("character_id") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
