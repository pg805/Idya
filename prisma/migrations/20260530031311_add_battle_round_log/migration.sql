-- CreateTable
CREATE TABLE "BattleRoundLog" (
    "id" TEXT NOT NULL,
    "battle_id" TEXT NOT NULL,
    "rounds" JSONB NOT NULL,

    CONSTRAINT "BattleRoundLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BattleRoundLog_battle_id_key" ON "BattleRoundLog"("battle_id");

-- AddForeignKey
ALTER TABLE "BattleRoundLog" ADD CONSTRAINT "BattleRoundLog_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "BattleLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
