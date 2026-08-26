-- Quests the GM hands out (docs/world.md §7).
--
-- Additive: three new tables. GlobalQuest is untouched; this counts things
-- people DO, and 'deposit' is one of the objectives it can count, so the older
-- deposit board folds in here when it moves over rather than being replaced now.
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL DEFAULT '',
    -- 'solo' gives every assignee their own target and reward; 'group' pools
    -- everyone into one total.
    "scope" TEXT NOT NULL DEFAULT 'group',
    -- 'chop' | 'dig' | 'kill' | 'deposit' | 'manual'. 'manual' has no counter:
    -- the GM marks it done, which is how something that happened at the table
    -- becomes a quest without needing code first.
    "objective" TEXT NOT NULL,
    "target_key" TEXT,
    "target_count" INTEGER NOT NULL DEFAULT 1,
    -- { korel, items: { id: n }, weapons: [key] }
    "reward" JSONB NOT NULL DEFAULT '{}',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Quest_status_idx" ON "Quest"("status");

-- Who it is for. No rows means open to the whole town.
CREATE TABLE "QuestAssignee" (
    "quest_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,

    CONSTRAINT "QuestAssignee_pkey" PRIMARY KEY ("quest_id", "character_id")
);
CREATE INDEX "QuestAssignee_character_id_idx" ON "QuestAssignee"("character_id");

-- What one character has done towards it. Kept per person even on a group
-- quest, so a shared total still knows who filled it.
CREATE TABLE "QuestProgress" (
    "quest_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "rewarded_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestProgress_pkey" PRIMARY KEY ("quest_id", "character_id")
);
CREATE INDEX "QuestProgress_character_id_idx" ON "QuestProgress"("character_id");

ALTER TABLE "QuestAssignee" ADD CONSTRAINT "QuestAssignee_quest_id_fkey"
    FOREIGN KEY ("quest_id") REFERENCES "Quest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestProgress" ADD CONSTRAINT "QuestProgress_quest_id_fkey"
    FOREIGN KEY ("quest_id") REFERENCES "Quest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
