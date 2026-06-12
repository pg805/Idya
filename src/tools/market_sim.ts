// Market dynamics sim → SVG line chart. Runs the SAME pure shop_math the live
// server uses over 14 days, for several items, under TWO regimes each:
//   • quiet   — no player trading: the item's inherent R-dynamics + inventory drift
//   • trading — heavy random churn + a sell flood (d3–5) and a buy spree (d9–10)
// so you can see how transactions swamp the underlying signal.
//
//   node lib/tools/market_sim.js   ->   writes public/market_sim.svg
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { currentR, logisticStep, effectiveMultiplier, inventoryStep, clamp, X_FLOOR } from '../economy/shop_math.js';
import type { ShopItemListing } from '../economy/shop_loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOPS = join(__dirname, '../../database/shops');

function loadItem(id: string): ShopItemListing {
  for (const f of fs.readdirSync(SHOPS).filter(f => f.endsWith('.yaml'))) {
    const d = yaml.load(fs.readFileSync(join(SHOPS, f), 'utf8')) as { Items?: Record<string, unknown>[] };
    const it = (d.Items ?? []).find(i => i['id'] === id);
    if (!it) continue;
    return {
      id, base_buy: it['Base_Buy'], base_sell: it['Base_Sell'], r: it['R'], r_max: it['R_Max'],
      volume_sensitivity: it['Volume_Sensitivity'], transaction_threshold: it['Transaction_Threshold'],
      stock_max: it['Stock_Max'], stock_influence: it['Stock_Influence'], restock_field: it['Restock_Field'],
    } as unknown as ShopItemListing;
  }
  throw new Error(`item ${id} not found in any shop`);
}

const HOURS = 14 * 24, TICK_H = 4, DECAY = 0.94;
const seeded = (s: number) => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// flowAt(h, cap, rng) = net units players trade that hour (+ = selling/supply up).
function run(item: ShopItemListing, flowAt: (h: number, cap: number, rng: () => number) => number): number[] {
  const cap = item.stock_max as number, base = item.base_sell as number, thr = item.transaction_threshold as number;
  const rng = seeded(99);
  let x = 0.5, stock = Math.floor(cap / 2), rv = 0;
  const out: number[] = [];
  for (let h = 0; h <= HOURS; h++) {
    const flow = flowAt(h, cap, rng);
    stock = clamp(stock + flow, 0, cap);
    rv += Math.abs(flow);
    if (Math.abs(flow) >= thr) {
      const mag = Math.min(Math.abs(flow) / thr, 3) * 0.1;
      x = clamp(x + (flow > 0 ? -1 : 1) * mag, X_FLOOR, 1);
    }
    stock = inventoryStep(stock, cap, item.restock_field as number[], rng);
    if (h % TICK_H === 0) { rv = Math.floor(rv * DECAY); x = logisticStep(x, currentR(item, rv)); }
    out.push((base * effectiveMultiplier(item, x, stock)) / base);
  }
  return out;
}

const quiet   = () => 0;
const trading = (h: number, cap: number, rng: () => number) => {
  let f = Math.round((rng() - 0.5) * Math.max(cap * 0.04, 3));   // heavy random churn
  if (h >= 72  && h < 120) f += Math.max(Math.round(cap * 0.04), 3);  // d3–5 sell flood
  if (h >= 216 && h < 240) f -= Math.max(Math.round(cap * 0.06), 4);  // d9–10 buy spree
  return f;
};
function stdev(a: number[]) { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); }

// ── SVG (stacked panels, one per item) ───────────────────────────────────────
const W = 960, L = 60, RM = 150, PH = 150, GAP = 26, TOP = 34, BOT = 36;
const items = [
  { id: 'sulwood',       title: 'sulwood — commodity (R 2.0)' },
  { id: 'bottle_of_tar', title: 'tar — valuable (R 3.0)' },
  { id: 'antler_trophy', title: 'antler trophy — rare valuable (R 3.0, tiny stock)' },
];
const H = TOP + items.length * (PH + GAP) + BOT;
const pw = W - L - RM;
const xAt = (h: number) => L + (h / HOURS) * pw;

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="13">`);
parts.push(`<rect width="${W}" height="${H}" fill="#0e1726"/>`);
parts.push(`<text x="${L}" y="20" fill="#cfe0f5" font-size="15">Same item, same 14 days — quiet vs. heavy trading (sell flood d3–5, buy spree d9–10)</text>`);

items.forEach((meta, idx) => {
  const item = loadItem(meta.id);
  const q = run(item, quiet);
  const t = run(item, trading);
  const top = TOP + idx * (PH + GAP);
  const ymax = Math.min(4, Math.max(1.6, Math.max(...q, ...t) + 0.2));
  const yAt = (v: number) => top + PH - (Math.min(v, ymax) / ymax) * PH;
  // frame + gridlines
  parts.push(`<rect x="${L}" y="${top}" width="${pw}" height="${PH}" fill="#0b1320" stroke="#1a2740"/>`);
  for (let v = 0; v <= ymax + 0.001; v += (ymax > 2.5 ? 1 : 0.5)) {
    parts.push(`<line x1="${L}" y1="${yAt(v)}" x2="${L + pw}" y2="${yAt(v)}" stroke="#1a2740"/>`);
    parts.push(`<text x="${L - 7}" y="${yAt(v) + 4}" fill="#6f88ad" text-anchor="end">${v.toFixed(1)}×</text>`);
  }
  parts.push(`<line x1="${L}" y1="${yAt(1)}" x2="${L + pw}" y2="${yAt(1)}" stroke="#3a5070" stroke-dasharray="4 3"/>`);
  // event bands
  parts.push(`<rect x="${xAt(72)}" y="${top}" width="${xAt(120) - xAt(72)}" height="${PH}" fill="#ff5d6c" opacity="0.06"/>`);
  parts.push(`<rect x="${xAt(216)}" y="${top}" width="${xAt(240) - xAt(216)}" height="${PH}" fill="#4fa3ff" opacity="0.06"/>`);
  // lines: quiet (muted), trading (bright)
  parts.push(`<polyline points="${q.map((v, h) => `${xAt(h).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ')}" fill="none" stroke="#5b6f8f" stroke-width="1.4"/>`);
  parts.push(`<polyline points="${t.map((v, h) => `${xAt(h).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ')}" fill="none" stroke="#ffd24f" stroke-width="1.5" opacity="0.95"/>`);
  // title + per-panel stdevs
  parts.push(`<text x="${L}" y="${top - 5}" fill="#cfe0f5">${meta.title}</text>`);
  parts.push(`<text x="${L + pw + 12}" y="${top + 18}" fill="#5b6f8f">quiet</text>`);
  parts.push(`<text x="${L + pw + 12}" y="${top + 34}" fill="#5b6f8f" font-size="11">σ ${stdev(q).toFixed(3)}</text>`);
  parts.push(`<text x="${L + pw + 12}" y="${top + 58}" fill="#ffd24f">trading</text>`);
  parts.push(`<text x="${L + pw + 12}" y="${top + 74}" fill="#ffd24f" font-size="11">σ ${stdev(t).toFixed(3)}</text>`);
  // x labels on last panel
  if (idx === items.length - 1) for (let d = 0; d <= 14; d += 2) parts.push(`<text x="${xAt(d * 24)}" y="${top + PH + 18}" fill="#6f88ad" text-anchor="middle">d${d}</text>`);
  console.log(`${meta.title.padEnd(48)} quiet σ ${stdev(q).toFixed(3)}   trading σ ${stdev(t).toFixed(3)}`);
});
parts.push(`</svg>`);
fs.writeFileSync(join(__dirname, '../../public/market_sim.svg'), parts.join('\n'));
console.log('\nwrote public/market_sim.svg');
