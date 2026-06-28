// Dialogue tree: pure types, loading, condition evaluation, and the walker.
// No database access — everything here is a function of a tree + an EvalContext.
// The DB-facing side (context building, relation persistence) lives in service.ts.

import fs from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

// ---- Tree shape (authored YAML) ----------------------------------------

export type Conditions = Record<string, unknown>;

export interface Effects {
  opinion?: number;
  familiarity?: number;
  flag?: string;          // pushed onto sharedHistory
}

export interface SayVariant {
  // One spoken variant. `text` may be an array for multi-line (sequential)
  // delivery within the single variant.
  text: string | string[];
  conditions?: Conditions;
  weight?: number;
}

export interface DialogueOption {
  text: string;
  conditions?: Conditions;
  effects?: Effects;
  goto: string;           // node id, or "end"
}

export interface DialogueNode {
  say: SayVariant[];
  options?: DialogueOption[];
  optionsFrom?: string;     // borrow another node's options (e.g. a hub reusing greet's menu)
  topic?: string;           // groups related nodes; surfaces as `lastTopic` after you leave it
}

export interface EntryRule {
  node: string;
  conditions?: Conditions;
}

export interface DialogueTree {
  npc: string;
  entry: EntryRule[];
  nodes: Record<string, DialogueNode>;
}

// ---- The context conditions are evaluated against -----------------------
// `opinion` here is the mood-adjusted effectiveOpinion (that's what gates
// compare against). Raw opinion lives on the relation row, not here.

export interface EvalContext {
  playerName: string;
  metBefore: boolean;
  familiarity: number;
  opinion: number;                 // effectiveOpinion (mood-adjusted)
  standing: 'stranger' | 'regular' | 'trusted' | 'confidant';
  mood: number;
  faction: 'empire' | 'town' | 'neutral';
  sharedHistory: string[];
  recentHunts: string[];
  recentPurchases: string[];
  recentLosses: number;
  lumberjackRank: number;
  blacksmithRank: number;
  enchanterRank: number;
  lowStock: boolean;
  lowStockItem: string | null;
  lastTopic: string | null;        // the topic just left (null at conversation open)
}

// What the client renders for a node.
export interface NodeView {
  id: string;
  npcName: string;
  line: string | string[];
  options: Array<{ label: string }>;
  end: false;
}

// ---- Loading -----------------------------------------------------------

const cache = new Map<string, DialogueTree | null>();

export function loadTree(dir: string, npcId: string): DialogueTree | null {
  if (cache.has(npcId)) return cache.get(npcId) ?? null;
  let tree: DialogueTree | null = null;
  try {
    const path = join(dir, npcId, `${npcId}.yaml`);
    const file = fs.existsSync(path) ? path : join(dir, npcId, 'general_store.yaml');
    tree = yaml.load(fs.readFileSync(file, 'utf-8')) as DialogueTree;
  } catch {
    tree = null;
  }
  cache.set(npcId, tree);
  return tree;
}

export function clearTreeCache(): void { cache.clear(); }

// ---- Condition evaluation ----------------------------------------------

function compare(value: unknown, spec: string): boolean {
  const m = spec.match(/^(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const n = Number(m[2]);
    const x = Number(value);
    if (Number.isNaN(x)) return false;
    switch (m[1]) {
      case '>=': return x >= n;
      case '<=': return x <= n;
      case '>':  return x > n;
      case '<':  return x < n;
    }
  }
  const inc = spec.match(/^includes\s+(.+)$/);
  if (inc) return Array.isArray(value) && (value as unknown[]).includes(inc[1].trim());
  const exc = spec.match(/^excludes\s+(.+)$/);
  if (exc) return Array.isArray(value) && !(value as unknown[]).includes(exc[1].trim());
  return String(value) === spec;          // enum / exact-string match
}

function condPasses(value: unknown, spec: unknown): boolean {
  if (typeof spec === 'boolean') return value === spec;
  if (typeof spec === 'number')  return Number(value) === spec;
  if (typeof spec === 'string')  return compare(value, spec);
  return false;
}

export function conditionsMet(ctx: EvalContext, conditions?: Conditions): boolean {
  if (!conditions) return true;
  for (const [key, spec] of Object.entries(conditions)) {
    if (!condPasses((ctx as unknown as Record<string, unknown>)[key], spec)) return false;
  }
  return true;
}

// ---- Walker ------------------------------------------------------------

export function resolveEntry(tree: DialogueTree, ctx: EvalContext): string {
  for (const rule of tree.entry) {
    if (conditionsMet(ctx, rule.conditions)) return rule.node;
  }
  // Last resort: first node id in the map.
  return tree.entry[tree.entry.length - 1]?.node ?? Object.keys(tree.nodes)[0];
}

function substitute(text: string, ctx: EvalContext): string {
  return text
    .replace(/\{playerName\}/g, ctx.playerName)
    .replace(/\{lowStockItem\}/g, ctx.lowStockItem ?? 'that');
}

// Pick one spoken variant, by priority tier:
//   1. lines that react to the topic just left (condition on `lastTopic`),
//   2. else other conditioned (specific) lines that pass — mood/standing colour,
//   3. else unconditioned fallbacks.
// Weighted-random within the chosen tier.
function pickSay(node: DialogueNode, ctx: EvalContext): string | string[] {
  const eligible = node.say.filter(s => conditionsMet(ctx, s.conditions));
  const topical  = eligible.filter(s => s.conditions && Object.prototype.hasOwnProperty.call(s.conditions, 'lastTopic'));
  const specific = eligible.filter(s => s.conditions && Object.keys(s.conditions).length > 0);
  const pool = topical.length ? topical : (specific.length ? specific : eligible);
  if (pool.length === 0) return '';
  const total = pool.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  let roll = Math.random() * total;
  let chosen = pool[0];
  for (const s of pool) { roll -= (s.weight ?? 1); if (roll <= 0) { chosen = s; break; } }
  const text = chosen.text;
  return Array.isArray(text) ? text.map(t => substitute(t, ctx)) : substitute(text, ctx);
}

// A node's option list, resolving `optionsFrom` (a node can borrow another's menu).
function optionsOf(tree: DialogueTree, node: DialogueNode): DialogueOption[] {
  if (node.optionsFrom) return tree.nodes[node.optionsFrom]?.options ?? [];
  return node.options ?? [];
}

// The options eligible at a node, in authored order. The index into THIS list
// is what the client sends back to choose (the server re-derives the same list).
export function eligibleOptions(tree: DialogueTree, node: DialogueNode, ctx: EvalContext): DialogueOption[] {
  return optionsOf(tree, node).filter(o => conditionsMet(ctx, o.conditions));
}

export function nodeView(tree: DialogueTree, nodeId: string, npcName: string, ctx: EvalContext): NodeView {
  const node = tree.nodes[nodeId];
  return {
    id: nodeId,
    npcName,
    line: pickSay(node, ctx),
    options: eligibleOptions(tree, node, ctx).map(o => ({ label: substitute(o.text, ctx) })),
    end: false,
  };
}
