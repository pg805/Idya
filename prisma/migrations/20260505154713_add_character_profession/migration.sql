-- CreateTable
CREATE TABLE "CharacterProfession" (
    "character_id" TEXT NOT NULL,
    "profession" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CharacterProfession_pkey" PRIMARY KEY ("character_id","profession")
);

-- AddForeignKey
ALTER TABLE "CharacterProfession" ADD CONSTRAINT "CharacterProfession_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
