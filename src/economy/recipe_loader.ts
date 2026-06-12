import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

export interface RecipeIngredient {
  item_id?:   string;
  weapon_id?: string;
  quantity:   number;
}

export interface RecipeOutput {
  type:        'item' | 'weapon';
  id?:         string;
  quantity?:   number;
  base_bonus?: { defend?: number; attack?: number; special?: number };
}

export interface Recipe {
  id:             string;
  name:           string;
  description?:   string;
  profession:     string;
  required_level: number;
  ingredients:    RecipeIngredient[];
  output:         RecipeOutput;
  // Shop pricing margins applied on top of (Σ ingredient × qty). Default 1.1
  // for both — "10% over input cost" baseline; recipes can override.
  margin_buy:     number;
  margin_sell:    number;
}

const DEFAULT_MARGIN = 1.1;

export function loadAllRecipes(recipesDir: string): Recipe[] {
  if (!fs.existsSync(recipesDir)) return [];
  const files = fs.readdirSync(recipesDir).filter(f => f.endsWith('.yaml'));
  const recipes: Recipe[] = [];
  for (const file of files) {
    const raw = yaml.load(fs.readFileSync(path.join(recipesDir, file), 'utf-8')) as Record<string, unknown>;
    const list = Array.isArray(raw['recipes'])
      ? (raw['recipes'] as Record<string, unknown>[])
      : [raw];
    for (const r of list) {
      const out = r['output'] as Record<string, unknown>;
      recipes.push({
        id:             r['id']             as string,
        name:           r['name']           as string,
        description:    r['description']    as string | undefined,
        profession:     r['profession']     as string,
        required_level: r['required_level'] as number,
        ingredients: ((r['ingredients'] as Record<string, unknown>[]) ?? []).map(i => ({
          item_id:   i['item_id']   as string | undefined,
          weapon_id: i['weapon_id'] as string | undefined,
          quantity:  i['quantity']  as number,
        })),
        output: {
          type:       out['type']       as 'item' | 'weapon',
          id:         out['id']         as string | undefined,
          quantity:   out['quantity']   as number | undefined,
          base_bonus: out['base_bonus'] as { defend?: number; attack?: number; special?: number } | undefined,
        },
        margin_buy:  (r['margin_buy']  as number | undefined) ?? DEFAULT_MARGIN,
        margin_sell: (r['margin_sell'] as number | undefined) ?? DEFAULT_MARGIN,
      });
    }
  }
  return recipes;
}
