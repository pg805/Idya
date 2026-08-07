# Archived legacy code

Frozen reference, excluded from the build (see tsconfig `exclude`). Replaced by the spatial web-combat system in `src/server` + `src/combat`.

- `discord/` — the original Discord bot (slash commands, handlers, battle_manager).
- `battle.ts` — the legacy turn-based combat engine.
- `test_battle.ts` — its CLI driver (was `npm run cli-test`).
- `character/` — superseded character code.
- `dialogue/` — the NPC conversation engine (see below).

Internal imports point at the old `src/` tree and will not resolve as-is; revive by fixing paths if ever needed.

## `dialogue/` — the NPC conversation system

Archived when the game's direction shifted from simulating a world to being a
**platform players share** — a place to roleplay with each other and play an
economy. A deterministic, LLM-curated NPC that talks to one player at a time is
the purest form of the thing that was dropped: content the player consumes
alone. Effort goes to systems players meet each other through instead.

Nothing here was broken — it worked. It's frozen whole so it can come back if
NPCs later earn a role that serves players *together* (a quest broker, a market
maker, a faction voice).

| Was | Now |
|---|---|
| `src/dialogue/{service,tree}.ts` | `dialogue/src/` |
| `src/tools/dialogue_lint.ts` (`npm run dialogue:lint`) | `dialogue/dialogue_lint.ts` |
| `database/dialogue/` (Dolan's tree) | `dialogue/database/` |
| `public/views/talk.{js,css}` | `dialogue/talk.{js,css}` |
| `docs/npc-dialogue-system.md` | `dialogue/npc-dialogue-system.md` |

Also removed from the live tree: the `/api/talk/:npcId` GET/POST/reset endpoints
in `src/server/index.ts`, and the shop page's Talk column (`public/views/shop.js`
+ `shop.css`).

The Prisma model `PlayerNpcRelation` is **deliberately left in place**. Dropping
it is a destructive migration for no benefit — the table is inert with nothing
writing to it, and keeping it means an un-archive doesn't lose player history.
