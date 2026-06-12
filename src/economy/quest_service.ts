// Global timed quests. Definitions are authored as YAML in database/quests/
// (id, name, lore, item, target, price, starts_at, duration). A background
// scheduler materializes a def into a GlobalQuest row when its start time hits,
// and completes the quest (freezing per-player ranks) when its end time passes.
import fs from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { PrismaClient } from '@prisma/client';

export interface QuestDef {
  id:        string;
  name:      string;
  lore:      string;
  item_id:   string;
  target:    number;
  price:     number;
  starts_at: Date;
  ends_at:   Date;
}

export function loadQuestDefs(questsDir: string): QuestDef[] {
  if (!fs.existsSync(questsDir)) return [];
  const defs: QuestDef[] = [];
  for (const f of fs.readdirSync(questsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))) {
    const raw = yaml.load(fs.readFileSync(join(questsDir, f), 'utf8')) as Record<string, unknown> | null;
    if (!raw || !raw['id'] || !raw['starts_at']) continue;
    const startsAt = new Date(raw['starts_at'] as string);
    const durMin  = Number(raw['duration_minutes'] ?? 0);
    const durDays = Number(raw['duration_days'] ?? 0);
    const endsAt = new Date(startsAt.getTime() + durDays * 86_400_000 + durMin * 60_000);
    defs.push({
      id:        String(raw['id']),
      name:      String(raw['name'] ?? raw['id']),
      lore:      String(raw['lore'] ?? ''),
      item_id:   String(raw['item'] ?? raw['item_id'] ?? ''),
      target:    Number(raw['target'] ?? 0),
      price:     Number(raw['price'] ?? 0),
      starts_at: startsAt,
      ends_at:   endsAt,
    });
  }
  return defs;
}

// Materialize started quests into rows and complete expired ones. Idempotent —
// safe to run on every tick and to catch up after a restart.
export async function questTick(prisma: PrismaClient, questsDir: string): Promise<void> {
  const now = new Date();
  for (const def of loadQuestDefs(questsDir)) {
    if (now < def.starts_at) continue;
    const existing = await prisma.globalQuest.findUnique({ where: { id: def.id } });
    if (existing) continue;
    await prisma.globalQuest.create({ data: {
      id: def.id, name: def.name, lore: def.lore, item_id: def.item_id,
      target: def.target, price: def.price, starts_at: def.starts_at, ends_at: def.ends_at,
      status: now < def.ends_at ? 'active' : 'completed',
    }}).catch(() => { /* race: another tick created it */ });
  }
  const expired = await prisma.globalQuest.findMany({ where: { status: 'active', ends_at: { lte: now } } });
  for (const q of expired) await completeQuest(prisma, q.id);
}

// Freeze final standings: rank participants by quantity (earliest deposit breaks
// ties) and flip the quest to completed.
export async function completeQuest(prisma: PrismaClient, questId: string): Promise<void> {
  const deposits = await prisma.questDeposit.findMany({
    where: { quest_id: questId },
    orderBy: [{ quantity: 'desc' }, { created_at: 'asc' }],
  });
  await prisma.$transaction([
    prisma.globalQuest.update({ where: { id: questId }, data: { status: 'completed' } }),
    ...deposits.map((d, i) => prisma.questDeposit.update({ where: { id: d.id }, data: { rank: i + 1 } })),
  ]);
}

export function startQuestScheduler(prisma: PrismaClient, questsDir: string): void {
  const run = () => questTick(prisma, questsDir).catch(e => console.error('questTick error', e));
  run();
  setInterval(run, 60_000);
}
