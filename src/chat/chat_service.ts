import prisma from '../database/prisma.js';
import { Chunk } from './places.js';

/**
 * Persistence and validation for in-character chat.
 *
 * Kept apart from the socket layer so the rules are testable without a server
 * and so the GM console can reach the same moderation calls later.
 */

export const MAX_MESSAGE_LENGTH = 500;

export interface ChatLine {
  id: string;
  characterName: string;
  body: string;
  at: string;
  /** So a client can style its own lines without matching on names. */
  mine?: boolean;
}

/** Why a message is rejected, or null if it's fine. */
export function messageProblem(body: unknown): string | null {
  if (typeof body !== 'string') return 'Message must be text.';
  const trimmed = body.trim();
  if (trimmed.length === 0) return 'Message is empty.';
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return `Message must be under ${MAX_MESSAGE_LENGTH} characters.`;
  }
  return null;
}

/** Collapses runs of whitespace so nobody can shout with fifty blank lines. */
export function normalizeBody(body: string): string {
  return body.trim().replace(/\s*\n\s*\n\s*/g, '\n').replace(/[ \t]{2,}/g, ' ');
}

export async function saveMessage(args: {
  chunk: Chunk;
  accountId: string;
  characterId: string | null;
  characterName: string;
  body: string;
}): Promise<ChatLine> {
  const row = await prisma.chatMessage.create({
    data: {
      chunk_x: args.chunk.x,
      chunk_y: args.chunk.y,
      account_id: args.accountId,
      character_id: args.characterId,
      character_name: args.characterName,
      body: normalizeBody(args.body),
    },
  });
  return {
    id: row.id,
    characterName: row.character_name,
    body: row.body,
    at: row.created_at.toISOString(),
  };
}

/**
 * Recent history for a place.
 *
 * Not used by the live view on purpose. Chat is meant to feel like standing
 * somewhere, so arriving does not hand you a transcript of what you missed
 * (docs/world.md §2). This exists for the GM, for moderation, and for whatever
 * session-log feature wants it later.
 */
export async function recentMessages(chunk: Chunk, limit = 50): Promise<ChatLine[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { chunk_x: chunk.x, chunk_y: chunk.y, deleted_at: null },
    orderBy: { created_at: 'desc' },
    take: Math.min(limit, 200),
  });
  return rows.reverse().map(r => ({
    id: r.id,
    characterName: r.character_name,
    body: r.body,
    at: r.created_at.toISOString(),
  }));
}

/** Moderation hides rather than deletes, so the record survives. */
export async function hideMessage(id: string): Promise<void> {
  await prisma.chatMessage.updateMany({
    where: { id, deleted_at: null },
    data: { deleted_at: new Date() },
  });
}
