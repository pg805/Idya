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
