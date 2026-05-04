-- CreateTable
CREATE TABLE "CharacterWeapon" (
    "character_id" TEXT NOT NULL,
    "weapon_key" TEXT NOT NULL,

    CONSTRAINT "CharacterWeapon_pkey" PRIMARY KEY ("character_id","weapon_key")
);

-- AddForeignKey
ALTER TABLE "CharacterWeapon" ADD CONSTRAINT "CharacterWeapon_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed existing characters' equipped weapon into inventory
INSERT INTO "CharacterWeapon" ("character_id", "weapon_key")
SELECT "id", "weapon_key" FROM "Character"
ON CONFLICT DO NOTHING;
