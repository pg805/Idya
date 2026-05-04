import prisma from '../database/prisma.js';
import type { ShopConfig, ShopItemListing } from './shop_loader.js';

const PRICE_FLOOR    = 0.25;
const PRICE_CEILING  = 4.0;
const WINDOW_MS      = 7 * 24 * 60 * 60 * 1000;

export interface PricedItem extends ShopItemListing {
  buy?:  number;
  sell?: number;
}

export async function getPrices(shopKey: string, config: ShopConfig): Promise<PricedItem[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const txns  = await prisma.shopTransaction.findMany({
    where: { shop_id: shopKey, created_at: { gte: since } },
  });

  return config.items.map(item => {
    const itemTxns = txns.filter(t => t.item_id === item.id);
    const netBuys  = itemTxns.reduce((sum, t) =>
      sum + (t.type === 'buy' ? t.quantity : -t.quantity), 0
    );
    const multiplier = Math.max(PRICE_FLOOR, Math.min(PRICE_CEILING,
      1 + netBuys / config.sensitivity
    ));

    return {
      ...item,
      buy:  item.base_buy  != null ? Math.round(item.base_buy  * multiplier) : undefined,
      sell: item.base_sell != null ? Math.round(item.base_sell * multiplier) : undefined,
    };
  });
}

export async function buyItem(
  shopKey: string,
  characterId: string,
  discordId: string,
  itemId: string,
  quantity: number,
  unitPrice: number,
): Promise<{ success: boolean; message: string }> {
  const total = unitPrice * quantity;

  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { discord_id: discordId } });
    if (!user || user.korel < total) {
      return { success: false, message: `Not enough korel — need ${total}, have ${user?.korel ?? 0}.` };
    }

    await tx.user.update({ where: { discord_id: discordId }, data: { korel: { decrement: total } } });
    await tx.inventoryItem.upsert({
      where:  { character_id_item_id: { character_id: characterId, item_id: itemId } },
      update: { quantity: { increment: quantity } },
      create: { character_id: characterId, item_id: itemId, quantity },
    });
    await tx.shopTransaction.create({
      data: { shop_id: shopKey, item_id: itemId, type: 'buy', quantity, discord_id: discordId },
    });

    return { success: true, message: `Bought ${quantity}× for **${total} korel**.` };
  });
}

export async function sellItem(
  shopKey: string,
  characterId: string,
  discordId: string,
  itemId: string,
  quantity: number,
  unitPrice: number,
): Promise<{ success: boolean; message: string }> {
  const total = unitPrice * quantity;

  return prisma.$transaction(async tx => {
    const inv = await tx.inventoryItem.findUnique({
      where: { character_id_item_id: { character_id: characterId, item_id: itemId } },
    });
    if (!inv || inv.quantity < quantity) {
      return { success: false, message: `You only have ${inv?.quantity ?? 0}.` };
    }

    if (inv.quantity === quantity) {
      await tx.inventoryItem.delete({
        where: { character_id_item_id: { character_id: characterId, item_id: itemId } },
      });
    } else {
      await tx.inventoryItem.update({
        where:  { character_id_item_id: { character_id: characterId, item_id: itemId } },
        data:   { quantity: { decrement: quantity } },
      });
    }

    await tx.user.update({ where: { discord_id: discordId }, data: { korel: { increment: total } } });
    await tx.shopTransaction.create({
      data: { shop_id: shopKey, item_id: itemId, type: 'sell', quantity, discord_id: discordId },
    });

    return { success: true, message: `Sold ${quantity}× for **${total} korel**.` };
  });
}
