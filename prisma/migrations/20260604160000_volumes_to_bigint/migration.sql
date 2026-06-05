-- Widen ShopItemState.cumulative_volume and recent_volume from INT4 to BIGINT
-- so they don't overflow. Tutorial/test traffic on Infinite items can drive
-- cumulative_volume past 2.1B (INT4 ceiling) and break buy/sell transactions
-- with a "ConversionError: Unable to fit integer value '2147483648' into an
-- INT4" Prisma error. recent_volume self-decays at 0.7/tick so it rarely
-- climbs alone, but we widen it too for symmetry.
ALTER TABLE "ShopItemState" ALTER COLUMN "cumulative_volume" TYPE BIGINT;
ALTER TABLE "ShopItemState" ALTER COLUMN "recent_volume" TYPE BIGINT;
