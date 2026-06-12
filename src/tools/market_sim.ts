// Market dynamics sim → SVG line chart. Runs the SAME pure shop_math the live
// server uses over 14 days with simulated trading, for several items, and draws
// their price trajectories so the dynamics are visible. Commodities (R≈2, the
// logistic map's stable regime) should read flat; valuables (R≈3–3.99, the
// chaotic regime) should swing.
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

// Pull an item's config out of whatever shop holds it, mapping the YAML's
// capitalized fields onto the ShopItemListing shape the math expects.
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

// Run one item with light, liquidity-proportional trading (~1.5% of cap/hr of
// churn) so every item feels comparable pressure; the difference in the lines
// is the R-driven dynamics, not the trade size. Returns price/base each hour.
function run(item: ShopItemListing, rng: () => number): number[] {
  const cap = item.stock_max as number, base = item.base_sell as number, thr = item.transaction_threshold as number;
  let x = 0.5, stock = Math.floor(cap / 2), rv = 0;
  const out: number[] = [];
  for (let h = 0; h <= HOURS; h++) {
    const flow = Math.round((rng() - 0.48) * Math.max(cap * 0.006, 2));  // light churn — let inventory hold the band so R-dynamics show
    stock = clamp(stock + flow, 0, cap);
    rv += Math.abs(flow);
    if (Math.abs(flow) >= thr) {
      const mag = Math.min(Math.abs(flow) / thr, 3) * 0.1;
      x = clamp(x + (flow > 0 ? -1 : 1) * mag, X_FLOOR, 1);
    }
    stock = inventoryStep(stock, cap, item.restock_field as number[], rng);
    if (h % TICK_H === 0) { rv = Math.floor(rv * DECAY); x = logisticStep(x, currentR(item, rv)); }
    out.push((base * effectiveMultiplier(item, x, stock)) / base);  // price / base
  }
  return out;
}

function stdev(a: number[]): number {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}

// ── SVG ──────────────────────────────────────────────────────────────────────
const W = 960, H = 460, L = 56, R = 150, T = 24, B = 44;
const pw = W - L - R, ph = H - T - B;
const YMAX = 3;
const xAt = (h: number) => L + (h / HOURS) * pw;
const yAt = (v: number) => T + ph - (Math.min(v, YMAX) / YMAX) * ph;

function svg(series: { id: string; label: string; color: string; pts: number[] }[]): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="13">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#0e1726"/>`);
  // y gridlines
  for (let v = 0; v <= YMAX; v += 0.5) {
    const y = yAt(v);
    parts.push(`<line x1="${L}" y1="${y}" x2="${L + pw}" y2="${y}" stroke="#23314a" stroke-width="1"/>`);
    parts.push(`<text x="${L - 8}" y="${y + 4}" fill="#7891b5" text-anchor="end">${v.toFixed(1)}×</text>`);
  }
  // x axis (days)
  for (let d = 0; d <= 14; d += 2) {
    const x = xAt(d * 24);
    parts.push(`<line x1="${x}" y1="${T}" x2="${x}" y2="${T + ph}" stroke="#1a2740" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${T + ph + 20}" fill="#7891b5" text-anchor="middle">d${d}</text>`);
  }
  parts.push(`<line x1="${L}" y1="${yAt(1)}" x2="${L + pw}" y2="${yAt(1)}" stroke="#3a5070" stroke-width="1.5" stroke-dasharray="4 3"/>`);
  parts.push(`<text x="${L + pw + 6}" y="${yAt(1) + 4}" fill="#3a5070">base</text>`);
  // series
  series.forEach((s, i) => {
    const pts = s.pts.map((v, h) => `${xAt(h).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    parts.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="1.6" opacity="0.9"/>`);
    const ly = T + 6 + i * 22;
    parts.push(`<line x1="${L + pw + 16}" y1="${ly}" x2="${L + pw + 34}" y2="${ly}" stroke="${s.color}" stroke-width="3"/>`);
    parts.push(`<text x="${L + pw + 38}" y="${ly + 4}" fill="#cfe0f5">${s.label}</text>`);
  });
  parts.push(`<text x="${L}" y="16" fill="#cfe0f5" font-size="14">Sell price ÷ base over 14 days — commodities vs valuables</text>`);
  parts.push(`</svg>`);
  return parts.join('\n');
}

const items = [
  { id: 'sulwood',        label: 'sulwood (commodity, R2.0)',   color: '#4fa3ff' },
  { id: 'bottle_of_tar',  label: 'tar (valuable, R3.0)',        color: '#ffb14f' },
  { id: 'antler_trophy',  label: 'antler trophy (valuable R3.0, rare)', color: '#ff5d6c' },
];
const rng = (() => { let s = 99; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const series = items.map(it => { const item = loadItem(it.id); return { ...it, pts: run(item, rng) }; });

const outPath = join(__dirname, '../../public/market_sim.svg');
fs.writeFileSync(outPath, svg(series));
console.log(`wrote ${outPath}\n`);
console.log('Volatility (stdev of price/base — higher = more chaotic):');
for (const s of series) {
  const min = Math.min(...s.pts), max = Math.max(...s.pts);
  console.log(`  ${s.label.padEnd(34)} stdev ${stdev(s.pts).toFixed(3)}   range ${min.toFixed(2)}–${max.toFixed(2)}×`);
}
