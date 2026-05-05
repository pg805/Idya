-- CreateTable
CREATE TABLE "ShopItemState" (
    "shop_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "cumulative_volume" INTEGER NOT NULL DEFAULT 0,
    "last_tick" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopItemState_pkey" PRIMARY KEY ("shop_id","item_id")
);
