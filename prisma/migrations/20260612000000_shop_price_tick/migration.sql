-- Tick-level price-state history (x + stock per item per hour), pruned to ~30
-- days. Lets us reconstruct and graph the real market like the sim does.
CREATE TABLE "ShopPriceTick" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "x" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL,
    CONSTRAINT "ShopPriceTick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShopPriceTick_shop_id_item_id_at_idx" ON "ShopPriceTick"("shop_id", "item_id", "at");
