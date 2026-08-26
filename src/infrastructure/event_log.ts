import prisma from '../database/prisma.js';

/**
 * Writing to the record.
 *
 * Append-only and best-effort: a log that can fail a player's action is worse
 * than a log with a hole in it, so every write here swallows its own errors.
 *
 * Everything discrete goes in. Movement is the exception and is handled below,
 * because it is not discrete: a held arrow key asks to move about eight times a
 * second, and a session of ten people walking around would put a few hundred
 * thousand rows in the table to describe something nobody would ever read step
 * by step.
 */

export interface EventAt {
  chunk?: { x: number; y: number } | null;
  tile?: { x: number; y: number } | null;
}

export async function logEvent(args: {
  accountId: string;
  characterId?: string | null;
  type: string;
  at?: EventAt;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.eventLog.create({
      data: {
        discord_id: args.accountId,
        character_id: args.characterId ?? null,
        event_type: args.type,
        chunk_x: args.at?.chunk?.x ?? null,
        chunk_y: args.at?.chunk?.y ?? null,
        tile_x: args.at?.tile?.x ?? null,
        tile_y: args.at?.tile?.y ?? null,
        payload: (args.payload ?? {}) as object,
      },
    });
  } catch (err) {
    console.error(`event log write failed (${args.type})`, (err as { code?: string })?.code ?? err);
  }
}

/**
 * How often one account's wandering is worth writing down, in ms.
 *
 * A trail, not a transcript. Set IDYA_MOVEMENT_LOG_MS to change it, or to 0 to
 * stop logging movement entirely; travelling between places is always recorded
 * regardless, because that is a decision rather than a footstep.
 */
const MOVEMENT_EVERY_MS = Number(process.env.IDYA_MOVEMENT_LOG_MS ?? 15_000);
const lastMovementAt = new Map<string, number>();

export async function logMovement(args: {
  accountId: string;
  characterId?: string | null;
  chunk: { x: number; y: number };
  tile: { x: number; y: number };
}): Promise<void> {
  if (MOVEMENT_EVERY_MS <= 0) return;
  const now = Date.now();
  const last = lastMovementAt.get(args.accountId) ?? 0;
  if (now - last < MOVEMENT_EVERY_MS) return;
  lastMovementAt.set(args.accountId, now);

  await logEvent({
    accountId: args.accountId,
    characterId: args.characterId,
    type: 'moved',
    at: { chunk: args.chunk, tile: args.tile },
  });
}

/** Forget somebody on disconnect, so the throttle map doesn't grow forever. */
export function forgetMovement(accountId: string): void {
  lastMovementAt.delete(accountId);
}
