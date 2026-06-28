// Dialogue service: the DB-facing side of the NPC chat engine.
// Builds the EvalContext from existing tables + the relation row + global mood,
// walks the tree (tree.ts), and persists opinion/familiarity/flags.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import prisma from '../database/prisma.js';
import {
  loadTree, resolveEntry, nodeView, eligibleOptions,
  type EvalContext, type NodeView, type Effects,
} from './tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIALOGUE_DIR = join(__dirname, '../../database/dialogue');

// NPC registry. Display name + mood baseline (Dolan runs cool).
const NPC_NAMES: Record<string, string> = { dolan: 'Dolan' };
const MOOD_BASELINE: Record<string, number> = { dolan: 4 };

const RECENT_DAYS    = 7;
const MOOD_TICK_MS   = 6 * 60 * 60 * 1000;   // mood re-rolls every 6h
const MOOD_SPREAD    = 3;                     // +/- swing around baseline
const MOOD_OPINION_K = 0.4;                   // how hard mood nudges effectiveOpinion
const CONFIDANT_RECENCY_MS = 14 * 24 * 60 * 60 * 1000;
const FAMILIARITY_COOLDOWN_MS = 60 * 60 * 1000;   // re-opening within an hour doesn't grind familiarity

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface TalkCharacter { id: string; name: string; faction: string | null; }
type Faction = 'empire' | 'town' | 'neutral';
type Standing = EvalContext['standing'];

interface Rel {
  opinion: number;
  familiarity: number;
  met_before: boolean;
  shared_history: string[];
  last_spoken_at: Date | null;
}

function asFaction(f: string | null | undefined): Faction {
  return f === 'empire' || f === 'town' ? f : 'neutral';
}

// New-acquaintance opinion: a neutral baseline skewed by faction (Dolan likes
// empire-leaners, distrusts town-leaners from the first word).
function initialOpinion(faction: Faction): number {
  const base = 5;
  return clamp(base + (faction === 'empire' ? 2 : faction === 'town' ? -2 : 0), 0, 10);
}

// ---- Global mood: deterministic per NPC per 6h tick ---------------------

function seeded(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let t = (h >>> 0) + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function npcMood(npcId: string, now: Date): number {
  const baseline = MOOD_BASELINE[npcId] ?? 5;
  const bucket = Math.floor(now.getTime() / MOOD_TICK_MS);
  const swing = seeded(`${npcId}:${bucket}`) * 2 - 1;   // [-1, 1]
  return clamp(Math.round(baseline + swing * MOOD_SPREAD), 0, 10);
}

// ---- Standing: derived, never stored. Decays via the recency gate. ------

function deriveStanding(rel: Rel): Standing {
  const recent = !!rel.last_spoken_at &&
    (Date.now() - rel.last_spoken_at.getTime() < CONFIDANT_RECENCY_MS);
  if (rel.familiarity >= 8 && rel.opinion >= 8 && recent) return 'confidant';
  if (rel.familiarity >= 4 && rel.opinion >= 6) return 'trusted';
  if (rel.met_before && rel.opinion >= 3) return 'regular';
  return 'stranger';
}

// ---- Relation row -------------------------------------------------------

async function getRelation(characterId: string, npcId: string, faction: Faction): Promise<Rel> {
  const row = await prisma.playerNpcRelation.findUnique({
    where: { character_id_npc_id: { character_id: characterId, npc_id: npcId } },
  });
  if (!row) {
    return { opinion: initialOpinion(faction), familiarity: 0, met_before: false, shared_history: [], last_spoken_at: null };
  }
  return {
    opinion: row.opinion,
    familiarity: row.familiarity,
    met_before: row.met_before,
    shared_history: Array.isArray(row.shared_history) ? (row.shared_history as string[]) : [],
    last_spoken_at: row.last_spoken_at,
  };
}

// ---- Context ------------------------------------------------------------

async function buildContext(npcId: string, char: TalkCharacter, discordId: string, rel: Rel): Promise<EvalContext> {
  const now = new Date();
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const faction = asFaction(char.faction);

  const [profs, battles, purchases] = await Promise.all([
    prisma.characterProfession.findMany({ where: { character_id: char.id } }),
    prisma.battleLog.findMany({ where: { character_id: char.id, ended_at: { gte: since } }, select: { enemy: true, outcome: true } }),
    prisma.shopTransaction.findMany({ where: { discord_id: discordId, type: 'buy', created_at: { gte: since } }, select: { item_id: true } }),
  ]);

  const rank = (k: string) => profs.find(p => p.profession === k)?.level ?? 0;
  const mood = npcMood(npcId, now);
  const baseline = MOOD_BASELINE[npcId] ?? 5;
  const effectiveOpinion = clamp(rel.opinion + Math.round((mood - baseline) * MOOD_OPINION_K), 0, 10);

  return {
    playerName: char.name,
    metBefore: rel.met_before,
    familiarity: rel.familiarity,
    opinion: effectiveOpinion,                 // gates compare against this
    standing: deriveStanding(rel),
    mood,
    faction,
    sharedHistory: rel.shared_history,
    recentHunts: [...new Set(battles.map(b => b.enemy))],
    recentPurchases: [...new Set(purchases.map(p => p.item_id))],
    recentLosses: battles.filter(b => b.outcome === 'loss' || b.outcome === 'forfeit').length,
    lumberjackRank: rank('lumberjack'),
    blacksmithRank: rank('blacksmith'),
    enchanterRank: rank('enchanter'),
    lowStock: false,            // TODO: wire to the NPC's shop stock (<50%)
    lowStockItem: null,
  };
}

// ---- Persistence --------------------------------------------------------

async function persist(characterId: string, npcId: string, rel: Rel, effects: Effects | undefined, opts: { meeting?: boolean }) {
  const opinion = clamp(rel.opinion + (effects?.opinion ?? 0), 0, 10);
  const famInc = (effects?.familiarity ?? 0) + (opts.meeting ? 1 : 0);
  const flags = new Set(rel.shared_history);
  if (effects?.flag) flags.add(effects.flag);

  await prisma.playerNpcRelation.upsert({
    where: { character_id_npc_id: { character_id: characterId, npc_id: npcId } },
    update: {
      opinion,
      familiarity: { increment: famInc },
      shared_history: [...flags],
      last_spoken_at: new Date(),
      ...(opts.meeting ? { met_before: true } : {}),
    },
    create: {
      character_id: characterId, npc_id: npcId,
      met_before: true, opinion, familiarity: famInc,
      shared_history: [...flags], last_spoken_at: new Date(),
    },
  });
}

// ---- Public API (called by the server) ----------------------------------

export type TalkResult = NodeView | { end: true };

export async function openConversation(npcId: string, char: TalkCharacter, discordId: string): Promise<TalkResult> {
  const tree = loadTree(DIALOGUE_DIR, npcId);
  if (!tree) return { end: true };
  const npcName = NPC_NAMES[npcId] ?? npcId;
  const faction = asFaction(char.faction);

  const rel = await getRelation(char.id, npcId, faction);
  const ctx = await buildContext(npcId, char, discordId, rel);  // reads metBefore as-is
  const entry = resolveEntry(tree, ctx);

  // Mark the meeting. Familiarity climbs once per conversation, but re-opening
  // within the cooldown only touches last_spoken_at (no grinding by re-opening).
  const recentlySpoke = !!rel.last_spoken_at &&
    (Date.now() - rel.last_spoken_at.getTime() < FAMILIARITY_COOLDOWN_MS);
  await persist(char.id, npcId, rel, undefined, { meeting: !recentlySpoke });

  return nodeView(tree, entry, npcName, ctx);
}

export async function chooseOption(npcId: string, char: TalkCharacter, discordId: string, nodeId: string, optionIndex: number): Promise<TalkResult> {
  const tree = loadTree(DIALOGUE_DIR, npcId);
  if (!tree) return { end: true };
  const node = tree.nodes[nodeId];
  if (!node) return { end: true };
  const npcName = NPC_NAMES[npcId] ?? npcId;
  const faction = asFaction(char.faction);

  const rel = await getRelation(char.id, npcId, faction);
  const ctx = await buildContext(npcId, char, discordId, rel);

  const chosen = eligibleOptions(node, ctx)[optionIndex];
  if (!chosen) return { end: true };

  await persist(char.id, npcId, rel, chosen.effects, {});

  if (chosen.goto === 'end' || !tree.nodes[chosen.goto]) return { end: true };

  // Re-read state after effects so the next node reflects the new opinion/flags.
  const rel2 = await getRelation(char.id, npcId, faction);
  const ctx2 = await buildContext(npcId, char, discordId, rel2);
  return nodeView(tree, chosen.goto, npcName, ctx2);
}
