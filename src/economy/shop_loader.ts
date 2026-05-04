import yaml from 'js-yaml';
import fs from 'fs';

export interface ShopItemListing {
  id: string;
  base_buy?: number;
  base_sell?: number;
  stock?: number | null;
}

export interface ShopConfig {
  name: string;
  npc: string;
  title: string;
  greeting: string;
  sensitivity: number;
  items: ShopItemListing[];
}

export function loadShop(shopKey: string, shopsDir: string): ShopConfig {
  const raw = yaml.load(fs.readFileSync(`${shopsDir}/${shopKey}.yaml`, 'utf-8')) as Record<string, unknown>;
  return {
    name:        raw['Name']        as string,
    npc:         raw['NPC']         as string,
    title:       raw['Title']       as string,
    greeting:    raw['Greeting']    as string,
    sensitivity: (raw['Sensitivity'] as number) ?? 100,
    items: ((raw['Items'] as Record<string, unknown>[]) ?? []).map(i => ({
      id:        i['id']       as string,
      base_buy:  i['Base_Buy']  as number | undefined,
      base_sell: i['Base_Sell'] as number | undefined,
      stock:     (i['Stock']   as number | undefined) ?? null,
    })),
  };
}
