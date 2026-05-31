-- Weapon instances: each owned weapon becomes a unique entity.
-- Character.weapon_key -> equipped_weapon_id (FK to CharacterWeapon.id)
-- CharacterWeapon composite PK -> id (uuid)

-- 1. Add id and created_at to CharacterWeapon
ALTER TABLE "CharacterWeapon" ADD COLUMN "id" TEXT;
ALTER TABLE "CharacterWeapon" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "CharacterWeapon" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "CharacterWeapon" ALTER COLUMN "id" SET NOT NULL;

-- 2. Swap PK: drop composite, set id as new PK
ALTER TABLE "CharacterWeapon" DROP CONSTRAINT "CharacterWeapon_pkey";
ALTER TABLE "CharacterWeapon" ADD CONSTRAINT "CharacterWeapon_pkey" PRIMARY KEY ("id");
CREATE INDEX "CharacterWeapon_character_id_weapon_key_idx" ON "CharacterWeapon"("character_id", "weapon_key");

-- 3. Add equipped_weapon_id to Character (nullable, will backfill)
ALTER TABLE "Character" ADD COLUMN "equipped_weapon_id" TEXT;

-- 4. Backfill: link each character to their currently equipped weapon's new id
UPDATE "Character" c
SET "equipped_weapon_id" = cw."id"
FROM "CharacterWeapon" cw
WHERE cw."character_id" = c."id" AND cw."weapon_key" = c."weapon_key";

-- 5. Add FK constraint
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_equipped_weapon_id_fkey"
  FOREIGN KEY ("equipped_weapon_id") REFERENCES "CharacterWeapon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Drop the now-unused weapon_key column on Character
ALTER TABLE "Character" DROP COLUMN "weapon_key";
