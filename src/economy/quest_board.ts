import prisma from '../database/prisma.js';

/**
 * The quest board: work the GM hands out, and what happens when it gets done.
 *
 * Distinct from `quest_service.ts`, which runs the older YAML-authored global
 * deposit quests on the Town Square. This one counts things people DO, and
 * 'deposit' is one of the objectives it can count, so the two fold together
 * when that board moves over.
 *
 * The counting is deliberately dumb. Something happens in the world, it says so,
 * and every open quest that cares about that thing ticks up. Nothing has to know
 * which quest it is contributing to at the moment it acts.
 */

export type Objective = 'chop' | 'dig' | 'kill' | 'deposit' | 'manual';
export type Scope = 'solo' | 'group';

export interface Reward {
  korel?: number;
  items?: Record<string, number>;
  weapons?: string[];
}

export interface QuestView {
  id: string;
  title: string;
  brief: string;
  scope: Scope;
  objective: Objective;
  targetKey: string | null;
  targetCount: number;
  reward: Reward;
  endsAt: string | null;
  status: string;
  /** Progress that matters to the asking character: theirs, or the pool. */
  count: number;
  /** Everyone who has put something in, best first. Group quests only. */
  contributors: Array<{ characterId: string; name: string; count: number }>;
  mine: boolean;
  open: boolean;
}

export const OBJECTIVES: Objective[] = ['chop', 'dig', 'kill', 'deposit', 'manual'];

/** What the counter means, for a quest list somebody has to read. */
export function describe(objective: Objective, count: number, key: string | null): string {
  switch (objective) {
    case 'chop':    return `Fell ${count} trees`;
    case 'dig':     return `Clear ${count} stumps`;
    case 'kill':    return `Defeat ${count} ${key ?? 'enemies'}`;
    case 'deposit': return `Deliver ${count} ${key ?? 'items'}`;
    case 'manual':  return 'As agreed with the GM';
  }
}

export async function createQuest(args: {
  title: string; brief?: string; scope: Scope; objective: Objective;
  targetKey?: string | null; targetCount: number; reward?: Reward;
  endsAt?: Date | null; createdBy?: string | null; assignees?: string[];
}): Promise<string> {
  const quest = await prisma.quest.create({
    data: {
      title: args.title,
      brief: args.brief ?? '',
      scope: args.scope,
      objective: args.objective,
      target_key: args.targetKey ?? null,
      target_count: Math.max(1, args.targetCount),
      reward: (args.reward ?? {}) as object,
      ends_at: args.endsAt ?? null,
      created_by: args.createdBy ?? null,
    },
  });
  if (args.assignees?.length) {
    await prisma.questAssignee.createMany({
      data: args.assignees.map(character_id => ({ quest_id: quest.id, character_id })),
      skipDuplicates: true,
    });
  }
  return quest.id;
}

/**
 * Record that a character did something, and pay out anything it finished.
 *
 * Returns the quests that completed, so the caller can say so out loud.
 */
export async function recordProgress(args: {
  characterId: string; objective: Objective; key?: string | null; amount?: number;
}): Promise<QuestView[]> {
  const amount = args.amount ?? 1;
  const now = new Date();

  const quests = await prisma.quest.findMany({
    where: {
      status: 'active',
      objective: args.objective,
      starts_at: { lte: now },
      OR: [{ ends_at: null }, { ends_at: { gt: now } }],
      AND: [{ OR: [
        // Open to the whole town, or to this character in particular.
        { assignees: { none: {} } },
        { assignees: { some: { character_id: args.characterId } } },
      ] }],
    },
    include: { assignees: true, progress: true },
  });

  const finished: QuestView[] = [];
  for (const q of quests) {
    // A keyed objective only counts the thing it named. An unkeyed one counts
    // anything of that kind, which is what "defeat 10 enemies" means.
    if (q.target_key && q.target_key !== args.key) continue;

    await prisma.questProgress.upsert({
      where: { quest_id_character_id: { quest_id: q.id, character_id: args.characterId } },
      update: { count: { increment: amount } },
      create: { quest_id: q.id, character_id: args.characterId, count: amount },
    });

    if (await isComplete(q.id, q.scope as Scope, q.target_count, args.characterId)) {
      const view = await completeQuest(q.id, args.characterId);
      if (view) finished.push(view);
    }
  }
  return finished;
}

async function isComplete(
  questId: string, scope: Scope, target: number, characterId: string,
): Promise<boolean> {
  if (scope === 'solo') {
    const row = await prisma.questProgress.findUnique({
      where: { quest_id_character_id: { quest_id: questId, character_id: characterId } },
    });
    return (row?.count ?? 0) >= target;
  }
  const all = await prisma.questProgress.aggregate({
    where: { quest_id: questId }, _sum: { count: true },
  });
  return (all._sum.count ?? 0) >= target;
}

/**
 * Pay a quest out.
 *
 * A solo quest pays whoever finished it. A group quest pays everybody who put
 * something in, because a shared job that pays only the person who landed the
 * last swing teaches everyone to wait for somebody else to start.
 */
export async function completeQuest(questId: string, byCharacterId?: string): Promise<QuestView | null> {
  const quest = await prisma.quest.findUnique({
    where: { id: questId }, include: { progress: true, assignees: true },
  });
  if (!quest || quest.status !== 'active') return null;

  const scope = quest.scope as Scope;
  const winners = scope === 'solo'
    ? (byCharacterId ? [byCharacterId] : [])
    : quest.progress.filter(p => p.count > 0).map(p => p.character_id);

  for (const characterId of winners) await payReward(characterId, quest.reward as Reward);

  // A solo quest handed to several people is several jobs, so it only closes
  // once nobody is left who could still finish theirs.
  const stillOpen = scope === 'solo' && quest.assignees.length > 1
    && quest.assignees.some(a => a.character_id !== byCharacterId
      && (quest.progress.find(p => p.character_id === a.character_id)?.count ?? 0) < quest.target_count);

  await prisma.questProgress.updateMany({
    where: { quest_id: questId, character_id: { in: winners } },
    data: { rewarded_at: new Date() },
  });
  if (!stillOpen) {
    await prisma.quest.update({ where: { id: questId }, data: { status: 'complete' } });
  }
  return viewFor(questId, byCharacterId ?? null);
}

async function payReward(characterId: string, reward: Reward): Promise<void> {
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return;

  if (reward.korel) {
    await prisma.user.update({
      where: { discord_id: character.discord_id },
      data: { korel: { increment: reward.korel } },
    });
    await prisma.korelLedger.create({
      data: { discord_id: character.discord_id, amount: reward.korel, reason: 'quest' },
    });
  }
  for (const [itemId, qty] of Object.entries(reward.items ?? {})) {
    if (!qty) continue;
    // One bad item id shouldn't void the rest of somebody's payout.
    await prisma.inventoryItem.upsert({
      where: { character_id_item_id: { character_id: characterId, item_id: itemId } },
      update: { quantity: { increment: qty } },
      create: { character_id: characterId, item_id: itemId, quantity: qty },
    }).catch(() => {});
  }
  for (const weaponKey of reward.weapons ?? []) {
    await prisma.characterWeapon.create({ data: { character_id: characterId, weapon_key: weaponKey } })
      .catch(() => {});
  }
}

export async function viewFor(questId: string, characterId: string | null): Promise<QuestView | null> {
  const q = await prisma.quest.findUnique({
    where: { id: questId }, include: { progress: true, assignees: true },
  });
  if (!q) return null;
  return shape(q, characterId, await namesFor(q.progress.map(p => p.character_id)));
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.character.findMany({
    where: { id: { in: ids } }, select: { id: true, name: true },
  });
  return new Map(rows.map(r => [r.id, r.name]));
}

interface QuestRow {
  id: string; title: string; brief: string; scope: string; objective: string;
  target_key: string | null; target_count: number; reward: unknown;
  ends_at: Date | null; status: string;
  progress: Array<{ character_id: string; count: number }>;
  assignees: Array<{ character_id: string }>;
}

function shape(q: QuestRow, characterId: string | null, names: Map<string, string>): QuestView {
  const scope = q.scope as Scope;
  const pooled = q.progress.reduce((n, p) => n + p.count, 0);
  const own = q.progress.find(p => p.character_id === characterId)?.count ?? 0;
  return {
    id: q.id,
    title: q.title,
    brief: q.brief,
    scope,
    objective: q.objective as Objective,
    targetKey: q.target_key,
    targetCount: q.target_count,
    reward: (q.reward ?? {}) as Reward,
    endsAt: q.ends_at ? q.ends_at.toISOString() : null,
    status: q.status,
    count: scope === 'solo' ? own : pooled,
    contributors: scope === 'group'
      ? q.progress.filter(p => p.count > 0)
          .sort((a, b) => b.count - a.count)
          .map(p => ({ characterId: p.character_id, name: names.get(p.character_id) ?? '?', count: p.count }))
      : [],
    mine: q.assignees.some(a => a.character_id === characterId),
    open: q.assignees.length === 0,
  };
}

/** Quests a character should see: theirs, plus everything open to the town. */
export async function questsFor(characterId: string | null, includeClosed = false): Promise<QuestView[]> {
  const rows = await prisma.quest.findMany({
    where: {
      ...(includeClosed ? {} : { status: 'active' }),
      ...(characterId ? { OR: [
        { assignees: { none: {} } },
        { assignees: { some: { character_id: characterId } } },
      ] } : {}),
    },
    include: { progress: true, assignees: true },
    orderBy: { created_at: 'desc' },
  });
  const names = await namesFor(rows.flatMap(r => r.progress.map(p => p.character_id)));
  return rows.map(r => shape(r as QuestRow, characterId, names));
}

/** Everything, for the GM. */
export async function allQuests(): Promise<QuestView[]> {
  const rows = await prisma.quest.findMany({
    include: { progress: true, assignees: true }, orderBy: { created_at: 'desc' },
  });
  const names = await namesFor(rows.flatMap(r => r.progress.map(p => p.character_id)));
  return rows.map(r => shape(r as QuestRow, null, names));
}

/** Close anything whose clock has run out. Cheap enough to call on read. */
export async function expireOverdue(): Promise<number> {
  const { count } = await prisma.quest.updateMany({
    where: { status: 'active', ends_at: { not: null, lte: new Date() } },
    data: { status: 'expired' },
  });
  return count;
}

export async function cancelQuest(questId: string): Promise<void> {
  await prisma.quest.updateMany({
    where: { id: questId, status: 'active' }, data: { status: 'cancelled' },
  });
}
