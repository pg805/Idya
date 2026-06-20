import yaml from 'js-yaml';
import fs from 'fs';

export interface ShopItemListing {
  id: string;
  base_buy?: number;
  base_sell?: number;
  infinite?: boolean;
  r: number;
  r_max: number;
  volume_sensitivity: number;
  transaction_threshold: number;
  stock_max: number;
  stock_influence: number;
  restock_field: number[];
}

export interface ShopConfig {
  name: string;
  npc: string;
  title: string;
  greeting: string;
  items: ShopItemListing[];
}

// Canonical base SELL price per item, scanned across every shop. An item's worth
// is what it sells for; items nothing buys (Base_Sell null/undefined — e.g. the
// swallow-bait permit) are absent from the map. If two shops list the same item,
// the highest sell price wins. Cached after the first build. Used by the orchard
// to set multiply odds (and unplantability) from an item's value.
const priceCache: Record<'buy' | 'sell', Map<string, number> | null> = { buy: null, sell: null };
function basePrices(shopsDir: string, which: 'buy' | 'sell'): Map<string, number> {
  if (priceCache[which]) return priceCache[which]!;
  const map = new Map<string, number>();
  for (const file of fs.readdirSync(shopsDir).filter(f => f.endsWith('.yaml'))) {
    const cfg = loadShop(file.replace(/\.yaml$/, ''), shopsDir);
    for (const it of cfg.items) {
      const v = which === 'buy' ? it.base_buy : it.base_sell;
      if (typeof v !== 'number') continue;
      const prev = map.get(it.id);
      if (prev === undefined || v > prev) map.set(it.id, v);
    }
  }
  priceCache[which] = map;
  return map;
}
export const baseSellPrices = (shopsDir: string): Map<string, number> => basePrices(shopsDir, 'sell');
export const baseBuyPrices  = (shopsDir: string): Map<string, number> => basePrices(shopsDir, 'buy');

export function loadShop(shopKey: string, shopsDir: string): ShopConfig {
  const raw = yaml.load(fs.readFileSync(`${shopsDir}/${shopKey}.yaml`, 'utf-8')) as Record<string, unknown>;
  return {
    name:     raw['Name']     as string,
    npc:      raw['NPC']      as string,
    title:    raw['Title']    as string,
    greeting: raw['Greeting'] as string,
    items: ((raw['Items'] as Record<string, unknown>[]) ?? []).map(i => ({
      id:                    i['id']                    as string,
      base_buy:              i['Base_Buy']              as number | undefined,
      base_sell:             i['Base_Sell']             as number | undefined,
      infinite:              i['Infinite']              as boolean | undefined,
      r:                     i['R']                     as number,
      r_max:                 i['R_Max']                 as number,
      volume_sensitivity:    i['Volume_Sensitivity']    as number,
      transaction_threshold: i['Transaction_Threshold'] as number,
      stock_max:             i['Stock_Max']             as number,
      stock_influence:       i['Stock_Influence']       as number,
      restock_field:         i['Restock_Field']         as number[],
    })),
  };
}
