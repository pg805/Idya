-- CreateTable
CREATE TABLE "User" (
    "discord_id" TEXT NOT NULL,
    "currency" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("discord_id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "discord_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "health" INTEGER NOT NULL,
    "max_health" INTEGER NOT NULL,
    "image" TEXT NOT NULL,
    "weapon_key" TEXT NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_discord_id_fkey" FOREIGN KEY ("discord_id") REFERENCES "User"("discord_id") ON DELETE RESTRICT ON UPDATE CASCADE;
