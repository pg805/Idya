// Renders REAL market price history (from the ShopPriceTick table) as an SVG —
// the same chart market_sim.ts draws, but from live data instead of simulation.
// Run server-side where DATABASE_URL is set:
//   node lib/tools/market_history.js sulwood bottle_of_tar antler_trophy [days]
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import prisma from '../database/prisma.js';
import { effectiveMultiplier } from '../economy/shop_math.js';
import type { ShopItemListing } from '../economy/shop_loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOPS = join(__dirname, '../../database/shops');

function loadItem(id: string): ShopItemListing | null {
  for (const f of fs.readdirSync(SHOPS).filter(f => f.endsWith('.yaml'))) {
    const d = yaml.load(fs.readFileSync(join(SHOPS, f), 'utf8')) as { Items?: Record<string, unknown>[] };
    const it = (d.Items ?? []).find(i => i['id'] === id);
    if (it) return { id, base_sell: it['Base_Sell'], stock_max: it['Stock_Max'], stock_influence: it['Stock_Influence'] } as unknown as ShopItemListing;
  }
  return null;
}

const COLORS = ['#4fa3ff', '#ffb14f', '#ff5d6c', '#7fdc8f', '#c89bff'];

async function main() {
  const args = process.argv.slice(2);
  const days = Number(args[args.length - 1]) || 14;
  const ids = args.filter(a => isNaN(Number(a)));
  if (ids.length === 0) { console.log('usage: market_history.js <itemId...> [days]'); return; }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const W = 960, L = 60, RM = 160, T = 30, B = 40, ph = 360 - T;
  const pw = W - L - RM, YMAX = 3;
  const t0 = since.getTime(), span = days * 24 * 60 * 60 * 1000;
  const xAt = (ms: number) => L + ((ms - t0) / span) * pw;
  const yAt = (v: number) => T + ph - (Math.min(v, YMAX) / YMAX) * ph;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${T + ph + B}" font-family="sans-serif" font-size="13">`,
    `<rect width="${W}" height="${T + ph + B}" fill="#0e1726"/>`,
    `<text x="${L}" y="18" fill="#cfe0f5" font-size="15">Real market price ÷ base — last ${days} days</text>`];
  for (let v = 0; v <= YMAX; v += 0.5) { parts.push(`<line x1="${L}" y1="${yAt(v)}" x2="${L + pw}" y2="${yAt(v)}" stroke="#23314a"/>`, `<text x="${L - 7}" y="${yAt(v) + 4}" fill="#6f88ad" text-anchor="end">${v.toFixed(1)}×</text>`); }
  parts.push(`<line x1="${L}" y1="${yAt(1)}" x2="${L + pw}" y2="${yAt(1)}" stroke="#3a5070" stroke-dasharray="4 3"/>`);

  let empty = true;
  for (let i = 0; i < ids.length; i++) {
    const item = loadItem(ids[i]);
    if (!item) { console.log(`skip ${ids[i]} (not in any shop)`); continue; }
    const ticks = await prisma.shopPriceTick.findMany({ where: { item_id: ids[i], at: { gte: since } }, orderBy: { at: 'asc' } });
    if (ticks.length === 0) { console.log(`no history yet for ${ids[i]}`); continue; }
    empty = false;
    const base = item.base_sell as number;
    const pts = ticks.map(t => `${xAt(t.at.getTime()).toFixed(1)},${yAt((base * effectiveMultiplier(item, t.x, t.stock)) / base).toFixed(1)}`).join(' ');
    parts.push(`<polyline points="${pts}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="1.5" opacity="0.9"/>`);
    parts.push(`<line x1="${L + pw + 12}" y1="${T + 8 + i * 20}" x2="${L + pw + 30}" y2="${T + 8 + i * 20}" stroke="${COLORS[i % COLORS.length]}" stroke-width="3"/>`);
    parts.push(`<text x="${L + pw + 34}" y="${T + 12 + i * 20}" fill="#cfe0f5">${ids[i]} (${ticks.length})</text>`);
  }
  parts.push('</svg>');
  if (empty) { console.log('No history recorded yet — let the market tick for a while first.'); await prisma.$disconnect(); return; }
  const out = join(__dirname, '../../public/market_history.svg');
  fs.writeFileSync(out, parts.join('\n'));
  console.log(`wrote ${out}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
