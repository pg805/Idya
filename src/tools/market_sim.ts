// Market dynamics sim — runs the SAME pure shop_math functions the live server
// uses (inventoryStep / currentR / logisticStep / effectiveMultiplier) over many
// hours, with simulated player trading, to validate the rework: prices should
// stay alive (always moving) and mean-revert — never ratchet to the floor.
//
//   node lib/tools/market_sim.js
import { currentR, logisticStep, effectiveMultiplier, inventoryStep, clamp, X_FLOOR } from '../economy/shop_math.js';
import type { ShopItemListing } from '../economy/shop_loader.js';

// sulwood, as configured (base sell 10 after the rescale).
const ITEM = {
  id: 'sulwood', base_buy: 50, base_sell: 10, r: 2.0, r_max: 3.4,
  volume_sensitivity: 50, transaction_threshold: 15, stock_max: 2000,
  stock_influence: 0.2, restock_field: [15, 25, 30, 40, 0], infinite: false,
} as unknown as ShopItemListing;

const HOURS = 14 * 24;
const TICK_H = 4;          // price tick every 4h
const DECAY = 0.94;

// Run the loop. sellsAt(h) = net player units sold to the shop that hour
// (positive = selling/supply up, negative = buying/supply down).
function run(sellsAt: (h: number) => number) {
  let x = 0.5, stock = Math.floor((ITEM.stock_max as number) / 2), rv = 0;
  const trace: { h: number; stock: number; price: number }[] = [];
  for (let h = 0; h <= HOURS; h++) {
    const flow = sellsAt(h);
    stock = clamp(stock + flow, 0, ITEM.stock_max as number);   // players trade
    rv += Math.abs(flow);
    if (Math.abs(flow) >= (ITEM.transaction_threshold as number)) {  // big batch shocks demand
      const dir = flow > 0 ? -1 : 1;
      const mag = Math.min(Math.abs(flow) / (ITEM.transaction_threshold as number), 3) * 0.1;
      x = clamp(x + dir * mag, X_FLOOR, 1);
    }
    stock = inventoryStep(stock, ITEM.stock_max as number, ITEM.restock_field as number[]);  // hourly NPC drift
    if (h % TICK_H === 0) { rv = Math.floor(rv * DECAY); x = logisticStep(x, currentR(ITEM, rv)); }
    trace.push({ h, stock, price: (ITEM.base_sell as number) * effectiveMultiplier(ITEM, x, stock) });
  }
  return trace;
}

function summarize(label: string, trace: { h: number; stock: number; price: number }[]) {
  const prices = trace.map(t => t.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  // "alive" = how often the price changes hour to hour
  let moves = 0; for (let i = 1; i < trace.length; i++) if (Math.abs(trace[i].price - trace[i - 1].price) > 0.001) moves++;
  console.log(`\n${label}`);
  console.log(`  sell price  min ${min.toFixed(1)}  avg ${avg.toFixed(1)}  max ${max.toFixed(1)}   (base_sell 10, floor 2.5, ceil 40)`);
  console.log(`  moves ${Math.round(100 * moves / (trace.length - 1))}% of hours   stock band ${Math.round(100 * Math.min(...trace.map(t => t.stock)) / 2000)}–${Math.round(100 * Math.max(...trace.map(t => t.stock)) / 2000)}%`);
  // sampled trajectory every 24h
  const samp = trace.filter(t => t.h % 24 === 0).map(t => t.price.toFixed(1));
  console.log('  daily price:', samp.join(' '));
}

const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
// A: light steady trading (a few sells per hour)
summarize('A — light steady trading', run(() => Math.round(rng() * 12)));
// B: a 2-day SELL FLOOD (players dump materials), then stop — does price recover?
summarize('B — heavy sell flood days 2–4, then quiet (recovery test)', run(h => (h >= 48 && h < 96) ? 120 : Math.round(rng() * 8)));
