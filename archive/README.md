# Archived legacy code

Frozen reference, excluded from the build (see tsconfig `exclude`). Replaced by the spatial web-combat system in `src/server` + `src/combat`.

- `discord/` — the original Discord bot (slash commands, handlers, battle_manager).
- `battle.ts` — the legacy turn-based combat engine.
- `test_battle.ts` — its CLI driver (was `npm run cli-test`).

Internal imports point at the old `src/` tree and will not resolve as-is; revive by fixing paths if ever needed.
