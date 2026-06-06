// Resolver smoke-test. Prints buy/sell prices for every shop item using the
// recipe-driven resolver against the current DB state. Run with:
//
//   npm run build && node ./lib/tools/price_smoke.js
//
// Useful after touching recipe margins or the resolver to sanity-check the
// chain (thuvel → hiruos → spellbook_hiruos, etc.) before shipping.

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadShop } from '../economy/shop_loader.js';
import { buildPricingContext } from '../economy/price_resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const SHOPS_DIR   = join(__dirname, '../../database/shops');
const RECIPES_DIR = join(__dirname, '../../database/recipes');

async function main() {
  const ctx = buildPricingContext(SHOPS_DIR, RECIPES_DIR);

  for (const file of fs.readdirSync(SHOPS_DIR).filter(f => f.endsWith('.yaml'))) {
    const shopKey = file.replace(/\.yaml$/, '');
    let config;
    try { config = loadShop(shopKey, SHOPS_DIR); }
    catch { continue; }
    if (config.items.length === 0) continue;

    console.log(`\n=== ${shopKey} ===`);
    console.log('item'.padEnd(28) + 'buy'.padStart(8) + 'sell'.padStart(8) + '  source');
    console.log('-'.repeat(56));

    for (const item of config.items) {
      const recipe = ctx.recipeFor(item.id);
      const [buy, sell] = await Promise.all([
        ctx.currentPrice(item.id, 'buy'),
        ctx.currentPrice(item.id, 'sell'),
      ]);
      const fmt = (v: number | null) => v == null ? '—' : Math.round(v).toString();
      const source = recipe ? `recipe ${recipe.id}` : 'raw';
      console.log(
        item.id.padEnd(28) +
        fmt(buy).padStart(8) +
        fmt(sell).padStart(8) +
        `  ${source}`,
      );
    }
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
