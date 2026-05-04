-- CreateTable
CREATE TABLE "ShopTransaction" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopTransaction_pkey" PRIMARY KEY ("id")
);
