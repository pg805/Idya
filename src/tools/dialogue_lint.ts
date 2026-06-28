// Dialogue lint + fuzz — how you verify an intentionally interconnected system:
// not by enumerating paths (combinatorial, and "correct" isn't even well-defined
// for emergent content), but by asserting INVARIANTS over the graph and over
// many random walks.
//
// Static invariants:
//   - every goto resolves (an existing node, or `end`)
//   - every node is reachable from an entry
//   - every node can reach an exit (`end`) — you can ALWAYS bail out. This is the
//     load-bearing one for loops: a loop must never trap you.
//   - no node has zero options (a silent dead-end)
//
// Fuzz: walk N random conversations under randomized state, applying the real
// heat/flag/opinion effects, and assert: never stuck (always >=1 eligible
// option), heat stays in bounds, and every walk terminates (a release is always
// reachable AND gets taken). A walker that never escapes a loop is a bug.
//
// Run: node lib/tools/dialogue_lint.js [npcId] [runs]

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadTree, resolveEntry, eligibleOptions, type DialogueTree, type DialogueNode, type EvalContext } from '../dialogue/tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIALOGUE_DIR = join(__dirname, '../../database/dialogue');
const HEAT_MAX = 6;
const STEP_CAP = 300;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function optionsOf(tree: DialogueTree, node: DialogueNode) {
  if (node.optionsFrom) return tree.nodes[node.optionsFrom]?.options ?? [];
  return node.options ?? [];
}

function staticChecks(tree: DialogueTree): string[] {
  const errs: string[] = [];
  const ids = new Set(Object.keys(tree.nodes));

  for (const e of tree.entry) if (!ids.has(e.node)) errs.push(`entry -> missing node "${e.node}"`);

  for (const [id, n] of Object.entries(tree.nodes)) {
    if (!n.say?.length) errs.push(`${id}: no say lines`);
    if (n.optionsFrom && !ids.has(n.optionsFrom)) errs.push(`${id}: optionsFrom -> missing "${n.optionsFrom}"`);
    const opts = optionsOf(tree, n);
    if (opts.length === 0) errs.push(`${id}: zero options (dead-end trap)`);
    for (const o of opts) if (o.goto !== 'end' && !ids.has(o.goto)) errs.push(`${id}: goto -> missing "${o.goto}"`);
  }

  // Reachable from an entry.
  const reach = new Set(tree.entry.map(e => e.node));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...reach]) for (const o of optionsOf(tree, tree.nodes[id])) {
      if (o.goto !== 'end' && !reach.has(o.goto)) { reach.add(o.goto); changed = true; }
    }
  }
  for (const id of ids) if (!reach.has(id)) errs.push(`${id}: unreachable from any entry`);

  // Can reach an exit (you can always get out — critical for loops).
  const canEnd = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, n] of Object.entries(tree.nodes)) {
      if (canEnd.has(id)) continue;
      for (const o of optionsOf(tree, n)) {
        if (o.goto === 'end' || canEnd.has(o.goto)) { canEnd.add(id); changed = true; break; }
      }
    }
  }
  for (const id of ids) if (!canEnd.has(id)) errs.push(`${id}: cannot reach an exit (TRAP)`);

  return errs;
}

function randomContext(): EvalContext {
  const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
  return {
    playerName: 'Fuzz',
    metBefore: Math.random() < 0.85,
    familiarity: Math.floor(Math.random() * 11),
    opinion: Math.floor(Math.random() * 11),
    standing: pick(['stranger', 'regular', 'trusted', 'confidant'] as const),
    mood: Math.floor(Math.random() * 11),
    faction: pick(['neutral', 'empire', 'town'] as const),
    sharedHistory: [],
    recentHunts: pick([[], ['lithkem_swallow'], ['child_of_sidaev'], ['sulgovenath']]),
    recentPurchases: pick([[], ['swallow_bait']]),
    recentLosses: Math.floor(Math.random() * 4),
    lumberjackRank: pick([0, 5, 8]),
    blacksmithRank: pick([0, 5, 8]),
    enchanterRank: pick([0, 5, 8]),
    lowStock: false,
    lowStockItem: null,
    lastTopic: null,
    heat: 0,
  };
}

function fuzz(tree: DialogueTree, runs: number): { fails: string[]; maxSteps: number; maxHeat: number } {
  const fails: string[] = [];
  let maxSteps = 0, maxHeat = 0;
  for (let r = 0; r < runs; r++) {
    const ctx = randomContext();
    let nodeId = resolveEntry(tree, ctx);
    let steps = 0;
    for (; steps < STEP_CAP; steps++) {
      const node = tree.nodes[nodeId];
      const opts = eligibleOptions(tree, node, ctx);
      if (opts.length === 0) { fails.push(`run ${r}: STUCK at "${nodeId}" (no eligible option)`); break; }
      const choice = opts[Math.floor(Math.random() * opts.length)];
      const fx = choice.effects;
      if (fx?.flag) ctx.sharedHistory = [...new Set([...ctx.sharedHistory, fx.flag])];
      if (typeof fx?.opinion === 'number') ctx.opinion = clamp(ctx.opinion + fx.opinion, 0, 10);
      if (typeof fx?.heat === 'number') ctx.heat = clamp(ctx.heat + fx.heat, 0, HEAT_MAX);
      maxHeat = Math.max(maxHeat, ctx.heat);
      ctx.lastTopic = node.topic ?? nodeId;
      if (choice.goto === 'end') { steps++; break; }
      nodeId = choice.goto;
    }
    maxSteps = Math.max(maxSteps, steps);
    if (steps >= STEP_CAP) fails.push(`run ${r}: did not terminate in ${STEP_CAP} steps (a release was never reachable?)`);
    if (ctx.heat < 0 || ctx.heat > HEAT_MAX) fails.push(`run ${r}: heat out of bounds (${ctx.heat})`);
  }
  return { fails, maxSteps, maxHeat };
}

const npcId = process.argv[2] ?? 'dolan';
const runs = Number(process.argv[3] ?? 5000);
const tree = loadTree(DIALOGUE_DIR, npcId);
if (!tree) { console.error(`No dialogue tree for "${npcId}".`); process.exit(1); }

console.log(`Linting "${npcId}" — ${Object.keys(tree.nodes).length} nodes.`);
const sErrs = staticChecks(tree);
const { fails, maxSteps, maxHeat } = fuzz(tree, runs);

if (sErrs.length) { console.log(`\nSTATIC (${sErrs.length}):`); for (const e of sErrs) console.log('  ✗ ' + e); }
else console.log('  ✓ static invariants hold (gotos resolve, all reachable, all escapable, no dead-ends)');

if (fails.length) { console.log(`\nFUZZ (${fails.length} of ${runs}):`); for (const f of fails.slice(0, 20)) console.log('  ✗ ' + f); }
else console.log(`  ✓ ${runs} random walks: never stuck, all terminated (longest ${maxSteps} steps), heat peaked at ${maxHeat}/${HEAT_MAX}`);

process.exit(sErrs.length || fails.length ? 1 : 0);
