-- Global timed quests: players deposit an item toward a shared target for a fixed
-- price; participants earn a rank-tiered trophy (QuestDeposit) when the quest ends.
CREATE TABLE "GlobalQuest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lore" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "deposited" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GlobalQuest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestDeposit" (
    "id" TEXT NOT NULL,
    "quest_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuestDeposit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestDeposit_quest_id_character_id_key" ON "QuestDeposit"("quest_id", "character_id");

CREATE INDEX "QuestDeposit_character_id_idx" ON "QuestDeposit"("character_id");

ALTER TABLE "QuestDeposit" ADD CONSTRAINT "QuestDeposit_quest_id_fkey" FOREIGN KEY ("quest_id") REFERENCES "GlobalQuest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
