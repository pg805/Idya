import fs from 'fs';
import express, { type Request, type Response } from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  Client, GatewayIntentBits, Partials, Events,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  type Interaction,
  type GuildMember, type APIInteractionGuildMember,
} from 'discord.js';
import CharacterRepository from '../character/character_repository.js';
import { SPRITES } from '../character/sprites.js';
import prisma from '../database/prisma.js';
import { Prisma } from '@prisma/client';
import RewardService from '../economy/reward_service.js';
import type { LootTable } from '../economy/reward_service.js';
import worldConfig from './world_config.js';
import Weapon from '../weapon/weapon.js';
import { hpBudgetRatio } from '../tools/budget.js';
import { CombatSession, CombatantMeta, Combatant } from '../combat/combat_session.js';
import { CombatantState, effectiveMove } from '../combat/combatant_state.js';
import { CombatIntent } from '../combat/intent.js';
import { buildWeaponInfo, loadEnemy, enemyFootprintSize } from '../combat/enemy_loader.js';
import { generateAIIntent } from '../combat/ai.js';
import { generateReplay, runMatrix } from '../combat/replay_sim.js';
import { computeTelegraph } from '../combat/telegraph.js';
import { resolveIntents } from '../combat/resolution.js';
import { PatternActionType } from '../infrastructure/pattern.js';
import { chebyshevDist, cellsOf } from '../combat/board.js';
import { reachableTiles } from '../combat/movement.js';
import { loadShop, baseBuyPrices, type ShopItemListing } from '../economy/shop_loader.js';
import {
  orchardCapacity, fertilizerPool, expectedMultiplier, effectiveChance, advancePlot,
  ticksUntilCap, nextRollAt, ORCHARD_TICK_MS, type PlotState,
} from '../economy/orchard_service.js';
import { buildPricingContext } from '../economy/price_resolver.js';
import { effectiveMultiplier, effectiveCraftedMultiplier, CRAFTED_MULT_MIN, CRAFTED_MULT_MAX } from '../economy/shop_math.js';
import { getPrices, buyItem, sellItem, tickAllDue, TICK_INTERVAL_MS } from '../economy/shop_service.js';
import { ITEMS, isUnlock, trophyIdFor, enemyKeyFromTrophy } from '../economy/items.js';
import { startQuestScheduler } from '../economy/quest_service.js';
import { loadAllRecipes, type RecipeOutput, type Recipe } from '../economy/recipe_loader.js';
import {
  budgetForLevel, upgradeCost, totalUpgradesUsed, maxUpgrades, upgradeSplit,
  upgradeKind, actionsWithCategories, buildFieldLenMap,
  allRawActions, weaponUpgradeProfessions, normalizePlayerUpgrades,
  summedFieldBonus, summedValueBonus, totalUpgradesOnWeapon, weaponUpgradeCap,
  type Profession, type RawWeapon, type RawAction,
} from '../economy/upgrade_service.js';
import {
  ENCHANT_SLOTS, enchantRankRequired, DAMAGE_TYPES, DAMAGE_SUBTYPES,
  enchantHealthHp, upgradeEnchantEv, sidaevField, SIDAEV_DEF, buildSidaevAction,
  enchantSlotKey, enchantSlotsUsed, canAddEnchant, enchantCost,
  type EnchantType, type WeaponEnchant, type WeaponEnchants,
} from '../economy/enchant_service.js';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const sessions = new Map<string, CombatSession>();
const sessionMeta = new Map<string, { discordUserId: string; isTutorial: boolean; lootTables: LootTable[]; enemyKey: string; enemyName: string; weaponKey: string; weaponUpgrades: number; startedAt: Date; lastActivityAt: Date; endedAt: Date | null; rounds: { turn: number; log: string[] }[]; tutorialShown?: Set<string> }>();
const charRepo = new CharacterRepository();
const VALID_NATIONALITIES = ['Chae', 'Ketulvu'] as const;
type Nationality = typeof VALID_NATIONALITIES[number];

interface AuthToken { discordUserId: string; }
const authTokens = new Map<string, AuthToken>(); // token → user
const userTokens = new Map<string, string>();    // discordUserId → token (reuse across visits)

// ---- Trade sessions ----

interface TradeItem        { itemId: string; quantity: number; }
interface TradeWeaponEntry { id: string; name: string; bonus: number; }
interface TradeOffer       { items: TradeItem[]; weapons: TradeWeaponEntry[]; korel: number; }
interface TradePlayer      { discordId: string; charName: string; offer: TradeOffer; locked: boolean; confirmed: boolean; }
interface TradeSession     { tradeId: string; players: [TradePlayer, TradePlayer]; status: 'waiting' | 'active' | 'complete' | 'cancelled'; }
const emptyOffer = (): TradeOffer => ({ items: [], weapons: [], korel: 0 });

const tradeSessions = new Map<string, TradeSession>();

function projectOffer(offer: TradeOffer) {
  // Items: enrich with display name from the in-memory ITEMS map. (The
  // viewing client may not have this item in its own inventory, so it can't
  // resolve the name from itemNameById.) Weapons already carry their display
  // name + bonus count from the offering client.
  return {
    items:   offer.items.map(i => ({ ...i, name: ITEMS[i.itemId]?.name ?? i.itemId })),
    weapons: offer.weapons,
    korel:   offer.korel,
  };
}

function tradeSessionView(session: TradeSession, viewerId: string) {
  const you  = session.players.find(p => p.discordId === viewerId);
  const them = session.players.find(p => p.discordId !== viewerId);
  return {
    tradeId: session.tradeId,
    status:  session.status,
    you:   you  ? { ...you,  offer: projectOffer(you.offer)  } : undefined,
    them:  them ? { ...them, offer: projectOffer(them.offer) } : undefined,
  };
}

async function createTradeSession(
  initiatorDiscordId: string,
  targetDiscordId: string,
): Promise<
  | { ok: true; tradeId: string; initiatorToken: string; targetToken: string; initiatorCharName: string; targetCharName: string }
  | { ok: false; error: string }
> {
  if (initiatorDiscordId === targetDiscordId) return { ok: false, error: "You can't trade with yourself." };
  const [initiatorChars, targetChars] = await Promise.all([
    charRepo.list(initiatorDiscordId),
    charRepo.list(targetDiscordId),
  ]);
  if (initiatorChars.length === 0) return { ok: false, error: "You don't have a character yet." };
  if (targetChars.length === 0)    return { ok: false, error: "That player doesn't have a character yet." };
  const tradeId        = Math.random().toString(36).slice(2, 9);
  const initiatorToken = getOrCreateToken(initiatorDiscordId);
  const targetToken    = getOrCreateToken(targetDiscordId);
  tradeSessions.set(tradeId, {
    tradeId,
    status: 'waiting',
    players: [
      { discordId: initiatorDiscordId, charName: initiatorChars[0].name, offer: emptyOffer(), locked: false, confirmed: false },
      { discordId: targetDiscordId,    charName: targetChars[0].name,    offer: emptyOffer(), locked: false, confirmed: false },
    ],
  });
  setTimeout(() => tradeSessions.delete(tradeId), 10 * 60_000);
  return {
    ok: true, tradeId, initiatorToken, targetToken,
    initiatorCharName: initiatorChars[0].name, targetCharName: targetChars[0].name,
  };
}

function getOrCreateToken(discordId: string): string {
  let token = userTokens.get(discordId);
  if (!token) {
    token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    authTokens.set(token, { discordUserId: discordId });
    userTokens.set(discordId, token);
  }
  return token;
}

// ---- Telegraph ---- (computeTelegraph lives in combat/telegraph.ts, shared with the replay)

function refreshTelegraphs(session: CombatSession): void {
  session.telegraphs = {};
  for (const c of session.aiCombatants()) {
    const meta = session.meta.get(c.id);
    if (!meta) continue;
    const enemies = session.combatants.filter(e => e.teamId !== c.teamId);
    session.telegraphs[c.id] = computeTelegraph(meta, c, enemies, session);
  }
}

// ---- Session creation ----

const VALID_ENEMIES = ['lithkem_swallow', 'sulfolk', 'talwyrm', 'daefen_deer', 'maetoad', 'golnosar', 'melbear', 'tinpul', 'child_of_sidaev', 'sulgovenath'] as const;
type EnemyKey = typeof VALID_ENEMIES[number];

const BAIT_TO_ENEMY: Record<string, EnemyKey> = {
  swallow_bait: 'lithkem_swallow',
  sulfolk_bait: 'sulfolk',
  wyrm_bait:    'talwyrm',
  deer_bait:    'daefen_deer',
  toad_bait:    'maetoad',
  tar_bait:     'golnosar',
  bear_bait:    'melbear',
  tin_bait:     'tinpul',
  sidaev_bait:      'child_of_sidaev',
  sulgovenath_bait: 'sulgovenath',
};
const BAIT_ITEM_IDS = Object.keys(BAIT_TO_ENEMY);

// Apply per-character customizations (base/recipe bonuses, player upgrades, enchants)
// to a freshly-loaded Weapon in place. Without this, combat rolls against the base
// YAML field instead of the upgraded one.
type WeaponUpgradesJson = {
  base?:     Record<string, number | number[]>;
  player?:   unknown;
  enchants?: WeaponEnchants;
};
function applyWeaponCustomizations(weapon: Weapon, weaponKey: string, upgradesJson: unknown): void {
  if (!upgradesJson || typeof upgradesJson !== 'object') return;
  const upgrades = upgradesJson as WeaponUpgradesJson;
  const baseDeltas     = (upgrades.base ?? {}) as Record<string, number | number[]>;
  const professions    = weaponUpgradeProfessions(weaponKey);
  const playerUpgrades = normalizePlayerUpgrades(upgrades.player, professions[0]);
  const enchants       = upgrades.enchants ?? {};

  // Upgrade-enchants are keyed `upgrade:<action>`; index them by action name so
  // their EV bonus + optional retype ride the matching action below.
  const upgradeEnch: Record<string, WeaponEnchant> = {};
  for (const e of Object.values(enchants)) if (e.type === 'upgrade' && e.action) upgradeEnch[e.action] = e;

  const allCategories = [weapon.defend, weapon.defend_crit, weapon.attack, weapon.attack_crit, weapon.special, weapon.special_crit];
  for (const category of allCategories) {
    for (const action of category) {
      const name = action.name;
      const a    = action as unknown as { field?: { field: number[]; length: number }; value?: number; damage_type?: string; damage_subtype?: string };
      const enchB = upgradeEnch[name]?.delta;

      if (a.field && Array.isArray(a.field.field) && a.field.field.length > 0) {
        const base    = a.field.field;
        const baseB   = (baseDeltas[name] as number[] | undefined) ?? base.map(() => 0);
        const playerB = summedFieldBonus(playerUpgrades, professions, name, base.length);
        const enchArr = Array.isArray(enchB) ? enchB : base.map(() => 0);
        a.field.field = base.map((v, i) => v + (baseB[i] ?? 0) + (playerB[i] ?? 0) + (enchArr[i] ?? 0));
      } else if (typeof a.value === 'number' && a.value > 0) {
        const baseB   = (baseDeltas[name] as number | undefined) ?? 0;
        const playerB = summedValueBonus(playerUpgrades, professions, name);
        const enchV   = typeof enchB === 'number' ? enchB : 0;
        a.value = a.value + baseB + playerB + enchV;
      }

      const ench = upgradeEnch[name];
      if (ench) {
        if (ench.damage_subtype) a.damage_subtype = ench.damage_subtype;
        if (ench.damage_type)    a.damage_type    = ench.damage_type;
      }
    }
  }

  // Auto-HP from upgrades — the HP-portion of each committed upgrade (the EV
  // portion of each upgrade is the action deltas applied above).
  const hpBonus = (upgrades as { hpBonus?: number }).hpBonus;
  if (typeof hpBonus === 'number' && hpBonus > 0) weapon.hp += hpBonus;

  // Enchants: flat health, and injected Sidaev abilities (Attack-category).
  const weaponLevel = loadWeaponYaml(weaponKey, __dirname)?.Level ?? 1;
  for (const e of Object.values(enchants)) {
    if (e.type === 'health')      weapon.hp += enchantHealthHp(weaponLevel);
    else if (e.type === 'melee')  weapon.attack.push(buildSidaevAction('melee',  weaponLevel));
    else if (e.type === 'ranged') weapon.attack.push(buildSidaevAction('ranged', weaponLevel));
  }
}

// Random obstacle layout for non-tutorial hunt boards. 2-6 obstacles placed
// anywhere in the rectangle (1,0)-(5,4) inclusive. Player spawn (0,2) and
// enemy spawn (6,2) are outside that rectangle so they can't be obstacles
// themselves. Layouts that wall the player off from the enemy (e.g. 5
// obstacles in a single column) are rare but possible; we re-roll up to
// a few times if the BFS can't reach.
function pathExists(width: number, height: number, blocked: Set<string>, start: { x: number; y: number }, goal: { x: number; y: number }): boolean {
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const q: { x: number; y: number }[] = [start];
  while (q.length > 0) {
    const p = q.shift()!;
    if (p.x === goal.x && p.y === goal.y) return true;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = p.x + dx, ny = p.y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const k = `${nx},${ny}`;
        if (seen.has(k) || blocked.has(k)) continue;
        // No diagonal corner-cutting (matches the in-game movement rule —
        // a layout that walls the player off via this rule needs re-rolling).
        if (dx !== 0 && dy !== 0) {
          const ka = `${p.x},${ny}`, kb = `${nx},${p.y}`;
          if (blocked.has(ka) && blocked.has(kb)) continue;
        }
        seen.add(k);
        q.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

// Board geometry for hunt battles. Bigger than the tutorial so multi-enemy
// combat has room to maneuver and ranged actions feel meaningful.
const HUNT_BOARD_W = 12;
const HUNT_BOARD_H = 10;
const PLAYER_SPAWN_BOX = 5;            // player picks a random tile in (0..4, 0..4)
const ENEMY_DIST_MIN  = 6;             // min chebyshev distance from player spawn
const ENEMY_DIST_MAX  = 8;             // max chebyshev distance from player spawn (capped
                                       // by board geometry — worst-case player spawn at
                                       // (4,4) can only reach chebyshev 7 on a 12x10 board)
const ENEMY_PAIR_MIN_SEP = 3;          // min chebyshev distance between two enemies
const OBSTACLE_BUFFER = 1;             // tiles around each spawn tile that obstacles avoid
                                       // (1 = 3x3 area centered on each spawn tile)
// Obstacle count is sampled from a normal distribution centered on the mean,
// clamped to [MIN, MAX]. Bell shape favors ~10 obstacles, with the long tails
// occasionally giving very sparse or very crowded boards.
const OBSTACLE_COUNT_MEAN = 10;
const OBSTACLE_COUNT_STDDEV = 4;
const OBSTACLE_COUNT_MIN = 3;
const OBSTACLE_COUNT_MAX = 25;

function randomNormal(mean: number, stdDev: number): number {
  // Box-Muller; clamp u1 away from 0 so log doesn't blow up.
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

function rollObstacleCount(): number {
  const n = Math.round(randomNormal(OBSTACLE_COUNT_MEAN, OBSTACLE_COUNT_STDDEV));
  return Math.max(OBSTACLE_COUNT_MIN, Math.min(OBSTACLE_COUNT_MAX, n));
}

type Pos = { x: number; y: number };

function chebyshev(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Random player spawn in a top-left 5x5 box.
function randomPlayerSpawn(): Pos {
  return {
    x: Math.floor(Math.random() * PLAYER_SPAWN_BOX),
    y: Math.floor(Math.random() * PLAYER_SPAWN_BOX),
  };
}

// Pick an enemy spawn at a random distance/direction from the player, kept
// on-board and away from the player and any previously-placed enemy tiles.
function randomEnemySpawn(player: Pos, taken: Pos[], size = 1): Pos | null {
  for (let attempt = 0; attempt < 50; attempt++) {
    const dist = ENEMY_DIST_MIN + Math.floor(Math.random() * (ENEMY_DIST_MAX - ENEMY_DIST_MIN + 1));
    const angle = Math.random() * Math.PI * 2;
    const x = Math.round(player.x + Math.cos(angle) * dist);
    const y = Math.round(player.y + Math.sin(angle) * dist);
    // The anchor (top-left) must leave room for the whole size×size footprint.
    if (x < 0 || x + size > HUNT_BOARD_W || y < 0 || y + size > HUNT_BOARD_H) continue;
    const pos = { x, y };
    if (chebyshev(pos, player) < ENEMY_DIST_MIN) continue;
    if (taken.some(t => chebyshev(t, pos) < ENEMY_PAIR_MIN_SEP)) continue;
    return pos;
  }
  return null;
}

// Build the full board layout for a hunt: player spawn, enemy spawn(s),
// and obstacles. Obstacles avoid a 3x3 area around each spawn tile and
// the layout is BFS-verified so every enemy is reachable from the player.
function randomHuntBoard(enemyCount: number, enemySize = 1): {
  playerSpawn: Pos;
  enemySpawns: Pos[];
  obstacles: { pos: Pos; state: 'intact' }[];
} {
  for (let layoutAttempt = 0; layoutAttempt < 20; layoutAttempt++) {
    const playerSpawn = randomPlayerSpawn();

    const enemySpawns: Pos[] = [];
    let spawnFailed = false;
    for (let i = 0; i < enemyCount; i++) {
      const e = randomEnemySpawn(playerSpawn, enemySpawns, enemySize);
      if (!e) { spawnFailed = true; break; }
      enemySpawns.push(e);
    }
    if (spawnFailed) continue;

    // Tiles to keep free of obstacles: each spawn's footprint plus a buffer ring.
    // The player is a single square; an enemy covers size×size from its anchor.
    const noObstacle = new Set<string>();
    const reserve = (s: Pos, size: number) => {
      for (let dx = -OBSTACLE_BUFFER; dx < size + OBSTACLE_BUFFER; dx++)
        for (let dy = -OBSTACLE_BUFFER; dy < size + OBSTACLE_BUFFER; dy++)
          noObstacle.add(`${s.x + dx},${s.y + dy}`);
    };
    reserve(playerSpawn, 1);
    for (const e of enemySpawns) reserve(e, enemySize);

    const candidates: Pos[] = [];
    for (let x = 0; x < HUNT_BOARD_W; x++) {
      for (let y = 0; y < HUNT_BOARD_H; y++) {
        if (!noObstacle.has(`${x},${y}`)) candidates.push({ x, y });
      }
    }
    // Shuffle so we pick a random subset.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = rollObstacleCount();
    const picked = candidates.slice(0, count);
    const blocked = new Set(picked.map(p => `${p.x},${p.y}`));

    // Verify the player can reach every enemy without being walled off.
    const allReachable = enemySpawns.every(e =>
      pathExists(HUNT_BOARD_W, HUNT_BOARD_H, blocked, playerSpawn, e)
    );
    if (!allReachable) continue;

    return {
      playerSpawn,
      enemySpawns,
      obstacles: picked.map(pos => ({ pos, state: 'intact' as const })),
    };
  }

  // Fallback: empty obstacles, deterministic spawns. Should be extremely rare.
  // Anchor the enemy so its footprint stays on-board (size 1 → the far corner).
  const fx = HUNT_BOARD_W - enemySize;
  const fy = HUNT_BOARD_H - enemySize;
  return {
    playerSpawn: { x: 0, y: 0 },
    enemySpawns: enemyCount > 1
      ? [{ x: fx, y: 1 }, { x: fx, y: fy }]
      : [{ x: fx, y: fy }],
    obstacles: [],
  };
}

// Runs RewardService.grant once per defeated enemy (one entry in lootTables
// per enemy in the battle), and merges the results into a single RewardResult
// so the existing summary/UI logic doesn't have to know about multi-enemy.
async function grantAllLoot(
  discordId: string,
  characterId: string,
  lootTables: LootTable[],
  enemyName: string,
): Promise<{ currency: number; items: Array<{ name: string; quantity: number }>; summary: string }> {
  const service = new RewardService();
  let totalCurrency = 0;
  const mergedItems = new Map<string, number>(); // name → quantity
  for (const table of lootTables) {
    const r = await service.grant(discordId, characterId, table, enemyName);
    totalCurrency += r.currency;
    for (const i of r.items) {
      mergedItems.set(i.name, (mergedItems.get(i.name) ?? 0) + i.quantity);
    }
  }
  const items = [...mergedItems.entries()].map(([name, quantity]) => ({ name, quantity }));
  const lines = [
    ...(totalCurrency > 0 ? [`+${totalCurrency} Korel`] : []),
    ...items.map(i => `+${i.quantity}x ${i.name}`),
  ];
  return {
    currency: totalCurrency,
    items,
    summary: lines.length > 0 ? lines.join('\n') : 'No drops.',
  };
}

function createSession(
  sessionId: string,
  enemyKey: EnemyKey | 'tutorial_swallow',
  playerSprite?: string,
  playerName = 'Hero',
  weaponKey = 'branch',
  isTutorial = false,
  weaponUpgrades: unknown = null,
  enemyCount = 1,
): { session: CombatSession; lootTables: LootTable[]; enemyName: string } {
  const weapon     = Weapon.from_file(join(__dirname, `../../database/weapons/${weaponKey}.yaml`));
  if (weaponUpgrades) applyWeaponCustomizations(weapon, weaponKey, weaponUpgrades);
  const fistsInfo = buildWeaponInfo(weapon);
  const playerHp  = weapon.hp;
  const playerState = new CombatantState(playerName, playerHp, weapon.resource_name, weapon.resource_max);

  const enemyFile = isTutorial ? 'tutorial_swallow' : enemyKey;
  const enemyPath = join(__dirname, `../../database/enemies/${enemyFile}.yaml`);
  const effectiveCount = isTutorial ? 1 : Math.max(1, enemyCount);

  // Compute the full hunt layout (player spawn, enemy spawns, obstacles).
  // Tutorial keeps its fixed mini-board.
  const enemyFpSize = isTutorial ? 1 : enemyFootprintSize(enemyPath);
  const layout = isTutorial
    ? {
        playerSpawn: { x: 0, y: 1 },
        enemySpawns: [{ x: 5, y: 0 }],
        obstacles: [] as { pos: { x: number; y: number }; state: 'intact' }[],
      }
    : randomHuntBoard(effectiveCount, enemyFpSize);

  const enemies: Array<{ combatant: Combatant; meta: CombatantMeta; lootTable: LootTable }> = [];
  for (let i = 0; i < effectiveCount; i++) {
    const suffix = effectiveCount > 1 ? String.fromCharCode(65 + i) : null; // A, B, C...
    const id = effectiveCount > 1 ? `enemy-${suffix}` : 'enemy-1';
    const loaded = loadEnemy(enemyPath, {
      id,
      teamId: 'team-b',
      pos: layout.enemySpawns[i],
      movementRange: 2,
      // Tutorial enemies always start at pattern index 0 so the lesson
      // plays in the intended order (Fendalok's asides time off it).
      randomizePatternStart: !isTutorial,
      // Only the tutorial bird is scripted (walks its Pattern); every real hunt
      // enemy uses the utility planner.
      scripted: isTutorial,
    });
    if (suffix !== null) {
      loaded.combatant.name = `${loaded.combatant.name} ${suffix}`;
      loaded.meta.state.name = loaded.combatant.name; // log lines use state.name
    }
    enemies.push(loaded);
  }

  const boardConfig = isTutorial
    ? { width: 6, height: 2, obstacles: [] }
    : {
        width: HUNT_BOARD_W,
        height: HUNT_BOARD_H,
        obstacles: layout.obstacles,
      };

  const playerStartPos = layout.playerSpawn;

  const session = new CombatSession(
    sessionId,
    boardConfig,
    [
      {
        id: 'team-a',
        name: 'Player',
        combatants: [{
          id: 'player-1',
          name: playerName,
          hp: playerHp,
          maxHp: playerHp,
          resource: weapon.resource_max,
          maxResource: weapon.resource_max,
          resourceName: weapon.resource_name,
          pos: playerStartPos,
          size: 1,
          movementRange: 2,
          isAI: false,
          teamId: 'team-a',
          weaponInfo: fistsInfo,
          weight: weapon.weight,
          initiative: 0,
          initiativeRank: 0,
          sprite: playerSprite,
        }],
      },
      {
        id: 'team-b',
        name: 'Enemy',
        combatants: enemies.map(e => e.combatant),
      },
    ],
  );

  session.meta.set('player-1', { weapon: weapon, state: playerState, pattern: [], patternIndex: 0 });
  for (const e of enemies) session.meta.set(e.combatant.id, e.meta);
  session.phase = 'intent';
  refreshTelegraphs(session);
  return {
    session,
    lootTables: enemies.map(e => e.lootTable),
    enemyName: enemies[0].combatant.name.replace(/ [A-Z]$/, ''), // base name without suffix
  };
}

// ---- Web server ----

// Request log — one line per request to stdout, captured by PM2. Format:
//   2026-06-04T17:30:01.123Z 1.2.3.4 GET /app/shop/general_store 200 12ms
// Skipped paths: static assets (.js/.css/.png/etc) — they're high-volume and
// usually not interesting for debugging. Failures on dynamic routes (4xx/5xx)
// always log, including for skipped paths, so a missing CSS still shows up.
app.use((req: Request, res: Response, next) => {
  const start = Date.now();
  const ip = (req.headers['cf-connecting-ip'] as string | undefined)
    ?? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? '-';
  const isAsset = /\.(?:js|css|png|jpg|jpeg|svg|ico|webp|woff2?|map)(?:\?|$)/.test(req.url);
  res.on('finish', () => {
    const dur = Date.now() - start;
    if (!isAsset || res.statusCode >= 400) {
      console.log(`[req] ${new Date().toISOString()} ${ip} ${req.method} ${req.url} ${res.statusCode} ${dur}ms`);
    }
  });
  next();
});

app.use(express.static(join(__dirname, '../../public')));
app.use(express.json());

// --- Dev: AI replay generator (powers the dev replay view) ---
app.get('/api/dev/replay/options', (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!isDev(discordId)) { res.status(403).json({ error: 'Forbidden' }); return; }
  // Each option carries its Level; sorted by level then name for the dropdowns.
  const list = (dir: string) => fs.readdirSync(join(__dirname, dir))
    .filter(f => f.endsWith('.yaml') && f !== 'tutorial_swallow.yaml')
    .map(f => ({ name: f.replace('.yaml', ''), level: (yaml.load(fs.readFileSync(join(__dirname, dir, f), 'utf8')) as { Level?: number }).Level ?? 0 }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  res.json({ weapons: list('../../database/weapons'), enemies: list('../../database/enemies') });
});

app.get('/api/dev/replay', (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!isDev(discordId)) { res.status(403).json({ error: 'Forbidden' }); return; }
  const weapon = String(req.query.weapon || 'battle_axe');
  const enemy = String(req.query.enemy || 'golnosar');
  if (!/^[a-z0-9_]+$/i.test(weapon) || !/^[a-z0-9_]+$/i.test(enemy)) { res.status(400).json({ error: 'bad name' }); return; }
  try {
    res.json(generateReplay(weapon, enemy));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Full weapon×enemy sweep for the dev matrix page. Heavy (runs N battles per
// matchup synchronously) — N is clamped low so the request returns in seconds.
app.get('/api/dev/matrix', (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!isDev(discordId)) { res.status(403).json({ error: 'Forbidden' }); return; }
  const n = Math.max(5, Math.min(50, Number(req.query.n) || 20));
  try {
    res.json({ n, ...runMatrix(n) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// The committed canonical matrix for the running version (npm run matrix:save →
// docs/sim/<version>.json). Served here since docs/ isn't a static dir; both dev
// views read it. Dev-gated, but available in any env (unlike loadSimForVersion).
app.get('/api/dev/matrix/canonical', (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!isDev(discordId)) { res.status(403).json({ error: 'Forbidden' }); return; }
  const path = join(__dirname, `../../docs/sim/${APP_VERSION}.json`);
  if (!fs.existsSync(path)) { res.status(404).json({ error: `no canonical matrix for ${APP_VERSION}` }); return; }
  try { res.type('application/json').send(fs.readFileSync(path, 'utf-8')); }
  catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

// Client-side error capture — SPA posts unhandled errors here; we log to
// stdout (PM2 captures) so we can debug white screens / runtime crashes
// without needing the user's devtools open. No auth required intentionally:
// errors happen before auth in many cases, and the payload is rate-limit
// guarded by Express's default body size cap.
app.post('/api/client_error', (req: Request, res: Response) => {
  const ip = (req.headers['cf-connecting-ip'] as string | undefined) ?? req.socket.remoteAddress ?? '-';
  const ua = (req.headers['user-agent'] as string | undefined)?.slice(0, 200) ?? '-';
  const body = req.body ?? {};
  const summary = {
    ts:      new Date().toISOString(),
    ip,
    ua,
    url:     String(body.url ?? '').slice(0, 500),
    message: String(body.message ?? '').slice(0, 500),
    source:  String(body.source ?? '').slice(0, 200),
    line:    body.line,
    col:     body.col,
    stack:   String(body.stack ?? '').slice(0, 2000),
  };
  console.log(`[client_error] ${JSON.stringify(summary)}`);
  res.json({ ok: true });
});

// Read the bot version once at startup. Used to stamp asset URLs in HTML so
// every deploy invalidates browser + Cloudflare caches without relying on a
// per-URL purge — the URL is literally different so caches can't get stuck.
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    return String(pkg.version ?? 'dev');
  } catch (_) { return 'dev'; }
})();

function sendVersionedHtml(res: Response, file: 'index.html' | 'app.html'): void {
  const raw = fs.readFileSync(join(__dirname, '../../public', file), 'utf8');
  // Append ?v=VERSION to every same-origin .js/.css asset URL (skip ones
  // that already have a query string). HTML itself is sent no-cache so the
  // browser always picks up the latest version stamp on every navigation.
  const stamped = raw.replace(/(src|href)="(\/[^"?]+\.(?:js|css))"/g, `$1="$2?v=${APP_VERSION}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(stamped);
}

app.get('/battle/:sessionId', (_req: Request, res: Response) => {
  sendVersionedHtml(res, 'index.html');
});

app.get(/^\/app(\/.*)?$/, (_req: Request, res: Response) => {
  sendVersionedHtml(res, 'app.html');
});

// Redirect legacy standalone URLs to the /app equivalent (preserve ?auth=).
app.get('/shop/:shopKey', (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, `/app/shop/${req.params.shopKey}${qs}`);
});
app.get('/craft', (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, `/app/crafting${qs}`);
});
app.get('/weapon-stats', (req: Request, res: Response) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, `/app/weapon-stats${qs}`);
});

app.get('/api/weapons', (_req: Request, res: Response) => {
  const weaponsDir = join(__dirname, '../../database/weapons');
  const files      = fs.readdirSync(weaponsDir).filter(f => f.endsWith('.yaml'));
  const SET_KEYS   = ['Defend', 'Defend Crit', 'Attack', 'Attack Crit', 'Special', 'Special Crit'] as const;

  const PROF_NAMES: Record<string, string> = {
    lumberjack: 'Lumberjack', blacksmith: 'Blacksmith', enchanter: 'Enchanter',
  };

  const allRecipes  = loadAllRecipes(RECIPES_DIR);
  const craftedBy: Record<string, string[]> = {};
  for (const r of allRecipes) {
    if (r.output.type === 'weapon' && r.output.id && !r.output.base_bonus) {
      (craftedBy[r.output.id] ??= []).push(PROF_NAMES[r.profession] ?? r.profession);
    }
  }

  const weapons = files.map(file => {
    const raw = yaml.load(fs.readFileSync(join(weaponsDir, file), 'utf-8')) as Record<string, unknown>;
    const r   = raw['Resource'] as Record<string, unknown> | undefined;
    const key = file.replace('.yaml', '');
    return {
      key,
      name:        raw['Name']        as string,
      description: raw['Description'] as string ?? '',
      level:       raw['Level']       as number ?? 0,
      hp:          raw['HP']          as number ?? 0,
      resource:    r ? { name: r['Name'] as string, max: r['Max'] as number } : null,
      professions: craftedBy[key] ?? [],
      sets: SET_KEYS.map(label => ({
        label,
        actions: ((raw[label] as Record<string, unknown>[]) ?? []).map(a => ({
          name:           a['Name']           as string,
          type_name:      a['Type_Name']      as string,
          damage_type:    a['Damage_Type']    as string,
          damage_subtype: a['Damage_Subtype'] as string,
          field:          a['Field']          as number[] | undefined,
          value:          a['Value']          as number | undefined,
          cost:           a['Cost']           as number,
          aimed:          a['Aimed']          as boolean ?? false,
          range:          a['Range']          as number | undefined,
        })),
      })).filter(s => s.actions.length > 0),
    };
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  res.json({ weapons });
});

// True if the id matches a weapon YAML file (i.e. it's a weapon, not an item).
function isWeaponKey(key: string): boolean {
  return fs.existsSync(join(__dirname, `../../database/weapons/${key}.yaml`));
}

// Get the weapon_key of the character's equipped weapon (null if none).
async function equippedWeaponKey(char: { equipped_weapon_id: string | null }): Promise<string | null> {
  if (!char.equipped_weapon_id) return null;
  const w = await prisma.characterWeapon.findUnique({ where: { id: char.equipped_weapon_id } });
  return w?.weapon_key ?? null;
}

// Load equipped weapon's key + upgrades (the data combat needs to roll correct fields).
async function equippedWeaponForCombat(char: { equipped_weapon_id: string | null }): Promise<{ key: string; upgrades: unknown } | null> {
  if (!char.equipped_weapon_id) return null;
  const w = await prisma.characterWeapon.findUnique({ where: { id: char.equipped_weapon_id } });
  if (!w) return null;
  return { key: w.weapon_key, upgrades: w.upgrades };
}

// Count total bonuses on a weapon (base + player + enchants) for display as "+N"
function weaponBonusCount(weaponKey: string, upgradesJson: unknown): number {
  const raw = loadWeaponYaml(weaponKey, __dirname);
  if (!raw) return 0;
  const upgrades = (upgradesJson ?? {}) as {
    base?: Record<string, number | number[]>;
    player?: unknown;
    enchants?: Record<string, unknown>;
  };
  const fieldLens = buildFieldLenMap(raw);
  // Player upgrade count is stored directly now (EV deltas don't normalize to a
  // count) — each upgrade shows as "+1" (3 = a weapon level).
  const playerCount = (upgrades as { upgradesDone?: number }).upgradesDone ?? 0;
  const baseCount   = totalUpgradesUsed((upgrades.base ?? {}) as Record<string, number | number[]>, fieldLens);
  const enchantCount = upgrades.enchants ? Object.keys(upgrades.enchants).length : 0;

  return playerCount + baseCount + enchantCount;
}

app.get('/api/info/professions', (_req: Request, res: Response) => {
  const allRecipes = loadAllRecipes(RECIPES_DIR);
  const PROFS: Array<{ key: 'lumberjack' | 'blacksmith' | 'enchanter'; label: string }> = [
    { key: 'lumberjack', label: 'Lumberjack' },
    { key: 'blacksmith', label: 'Blacksmith' },
    { key: 'enchanter',  label: 'Enchanter'  },
  ];

  const result: Record<string, unknown> = {};
  for (const { key, label } of PROFS) {
    const levels = [];
    for (let lvl = 1; lvl <= PROFESSION_MAX_LEVEL; lvl++) {
      const recipes = allRecipes
        .filter(r => r.profession === key && r.required_level === lvl)
        .map(r => ({
          id:          r.id,
          name:        r.name,
          description: r.description,
          output_type: r.output.type,
        }));
      const budget       = budgetForLevel(lvl);
      const prevBudget   = lvl > 0 ? budgetForLevel(lvl - 1) : 0;
      const budgetAdded  = budget - prevBudget;
      levels.push({
        level: lvl,
        recipes,
        budget,
        budget_added: budgetAdded,
      });
    }
    result[key] = { label, levels };
  }

  res.json({ professions: result });
});

app.get('/api/info/enemies', (_req: Request, res: Response) => {
  const dir = join(__dirname, '../../database/enemies');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') && !f.startsWith('tutorial_'));
  const enemies = files.map(file => {
    const raw = yaml.load(fs.readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>;
    const loot = (raw['Loot'] as { Items?: Array<{ id: string; type: string; Field: number[] }> } | undefined)?.Items ?? [];
    const drops = loot.map(d => {
      const field = d.Field ?? [];
      const min = field.length ? Math.min(...field) : 0;
      const max = field.length ? Math.max(...field) : 0;
      const avg = field.length ? field.reduce((a, b) => a + b, 0) / field.length : 0;
      return {
        item_id:  d.id,
        name:     ITEMS[d.id]?.name ?? d.id,
        type:     d.type,
        field,
        min,
        max,
        avg:      Math.round(avg * 100) / 100,
      };
    });
    return {
      key:    file.replace('.yaml', ''),
      name:   raw['Name']   as string,
      health: raw['Health'] as number,
      level:  raw['Level']  as number ?? 0,
      drops,
    };
  }).sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));

  res.json({ enemies });
});

// Parses a markdown doc by H1 headers into top-level sections. Used by
// the Lore + Reference info pages.
function parseMarkdownSections(absPath: string): Array<{ title: string; body: string }> {
  if (!fs.existsSync(absPath)) return [];
  const raw = fs.readFileSync(absPath, 'utf-8');
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const h1 = line.match(/^# (.+)$/);
    if (h1) {
      if (current) sections.push(current);
      current = { title: h1[1].trim(), body: '' };
      continue;
    }
    if (current) current.body += line + '\n';
  }
  if (current) sections.push(current);
  return sections.map(s => ({ title: s.title, body: s.body.trim() }));
}

app.get('/api/info/lore', (_req: Request, res: Response) => {
  res.json({ sections: parseMarkdownSections(join(__dirname, '../../docs/lore/world_player.md')) });
});

app.get('/api/info/reference', (_req: Request, res: Response) => {
  res.json({ sections: parseMarkdownSections(join(__dirname, '../../docs/reference.md')) });
});

app.get('/api/info/about', (_req: Request, res: Response) => {
  res.json({ sections: parseMarkdownSections(join(__dirname, '../../docs/about.md')) });
});

// ---- Battle replay download ----
// Returns the self-contained structured replay for a session (board, roster,
// per-turn paths/actions, readable log). Lives as long as the session does, so
// it's downloadable from the result screen until the player leaves/claims.
app.get('/api/session/:id/replay', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const session = sessions.get(id);
  if (!session?.replay) { res.status(404).json({ error: 'no replay for this session' }); return; }
  res.setHeader('Content-Disposition', `attachment; filename="battle-replay-${id}.json"`);
  res.json(session.replay);
});

// ---- Settings ----
// Per-user preferences. New columns get added to the User table as features
// land; the endpoint returns a flat object the client can render against.

app.get('/api/settings', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const u = await prisma.user.findUnique({
    where: { discord_id: discordId },
    select: { ping_on_action: true },
  });
  res.json({ ping_on_action: u?.ping_on_action ?? false });
});

app.post('/api/settings', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const body = req.body ?? {};
  const update: { ping_on_action?: boolean } = {};
  if (typeof body.ping_on_action === 'boolean') update.ping_on_action = body.ping_on_action;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No valid settings in request.' }); return;
  }
  await prisma.user.update({ where: { discord_id: discordId }, data: update }).catch(() => {});
  res.json({ ok: true, ...update });
});

// Public market overview: every shop item's current price, expected R-curve
// range, and how long until the daily tick rolls. Useful for players watching
// for cheap buying windows or peak selling opportunities. Recomputes per
// request — no caching, since prices only meaningfully change on tick.
app.get('/api/info/market', async (_req: Request, res: Response) => {
  const ctx = buildPricingContext(SHOP_DIR, RECIPES_DIR);
  const TICK_MS = TICK_INTERVAL_MS;   // 4h — single source of truth (was a stale 24h hardcode)
  const now = Date.now();

  // Item market category. Raw items use ITEMS[].type ('material' / 'consumable'
  // → commodity; 'valuable' → valuable). Crafted items inherit: a recipe is a
  // valuable if any ingredient walks back to a valuable, otherwise commodity.
  // Memoized so a deep chain (kustaff → quarterstaff → sulwood) doesn't get
  // re-classified per request.
  const categoryMemo = new Map<string, 'commodity' | 'valuable'>();
  function categoryOf(itemId: string, visited = new Set<string>()): 'commodity' | 'valuable' {
    if (categoryMemo.has(itemId)) return categoryMemo.get(itemId)!;
    if (visited.has(itemId)) return 'commodity';
    visited.add(itemId);
    const recipe = ctx.recipeFor(itemId);
    let cat: 'commodity' | 'valuable';
    if (recipe) {
      cat = 'commodity';
      for (const ingr of recipe.ingredients) {
        const ingrId = ingr.item_id ?? ingr.weapon_id;
        if (!ingrId) continue;
        if (categoryOf(ingrId, visited) === 'valuable') { cat = 'valuable'; break; }
      }
    } else {
      const t = ITEMS[itemId]?.type;
      cat = t === 'valuable' ? 'valuable' : 'commodity';
    }
    categoryMemo.set(itemId, cat);
    visited.delete(itemId);
    return cat;
  }

  type MarketRow = {
    shop_id:           string;
    shop_name:         string;
    item_id:           string;
    item_name:         string;
    item_type:         string;
    category:          'commodity' | 'valuable';
    source:            'raw' | 'recipe';
    recipe_id:         string | null;
    current_buy:       number | null;
    current_sell:      number | null;
    min_expected_buy:  number | null;
    max_expected_buy:  number | null;
    min_expected_sell: number | null;
    max_expected_sell: number | null;
    last_tick:         string | null;
    seconds_to_next_tick: number | null;
  };
  const rows: MarketRow[] = [];

  for (const file of fs.readdirSync(SHOP_DIR).filter(f => f.endsWith('.yaml'))) {
    const shopKey = file.replace(/\.yaml$/, '');
    let config;
    try { config = loadShop(shopKey, SHOP_DIR); }
    catch { continue; }

    for (const item of config.items) {
      // Unlock items don't belong on the price overview — they have no
      // tradeable value and live in the "claim once and keep forever" lane.
      if (isUnlock(item.id)) continue;
      const recipe = ctx.recipeFor(item.id);
      const [curBuy, curSell, rangeBuy, rangeSell, state] = await Promise.all([
        ctx.currentPrice(item.id, 'buy'),
        ctx.currentPrice(item.id, 'sell'),
        ctx.currentRange(item.id, 'buy'),
        ctx.currentRange(item.id, 'sell'),
        prisma.shopItemState.findUnique({
          where: { shop_id_item_id: { shop_id: shopKey, item_id: item.id } },
        }),
      ]);

      const lastTick = state?.last_tick ?? null;
      const secondsToNextTick = lastTick
        ? Math.max(0, Math.round((lastTick.getTime() + TICK_MS - now) / 1000))
        : null;

      // Most shop items are in ITEMS, but craftable weapons live in their
      // own YAML and don't appear there — fall back to the weapon's Name
      // field so the market shows "Deck of Cards" instead of "deck_of_cards".
      const weaponYaml = ITEMS[item.id] ? null : loadWeaponYaml(item.id, __dirname);
      const itemName = ITEMS[item.id]?.name ?? (weaponYaml?.Name as string | undefined) ?? item.id;
      rows.push({
        shop_id:           shopKey,
        shop_name:         config.name,
        item_id:           item.id,
        item_name:         itemName,
        item_type:         ITEMS[item.id]?.type ?? (weaponYaml ? 'weapon' : 'unknown'),
        category:          categoryOf(item.id),
        source:            recipe ? 'recipe' : 'raw',
        recipe_id:         recipe?.id ?? null,
        current_buy:       curBuy  == null ? null : Math.round(curBuy),
        current_sell:      curSell == null ? null : Math.round(curSell),
        min_expected_buy:  rangeBuy?.min  != null ? Math.round(rangeBuy.min)  : null,
        max_expected_buy:  rangeBuy?.max  != null ? Math.round(rangeBuy.max)  : null,
        min_expected_sell: rangeSell?.min != null ? Math.round(rangeSell.min) : null,
        max_expected_sell: rangeSell?.max != null ? Math.round(rangeSell.max) : null,
        last_tick:         lastTick ? lastTick.toISOString() : null,
        seconds_to_next_tick: secondsToNextTick,
      });
    }
  }

  res.json({ items: rows });
});

// ---- Dev: historical price waves ----
// Replays the ShopPriceTick (x, stock) history through the SAME pricing math
// the live market uses (mirror of price_resolver.ts): raw items price at
// base × effectiveMultiplier; crafted items at (Σ ingredient price × qty /
// outputQty) × effectiveCraftedMultiplier, with ingredients resolved at the
// same point in time via carry-forward state (most recent tick at-or-before T).
// Returns one buy/sell series per item, plus the shop/category metadata the
// market page filters on, so the dev page can reuse the same chip selections.
// Keep the price formulas in sync with price_resolver.ts.
app.get('/api/dev/price-history', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!isDev(discordId)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // item_id → (shopKey, listing, shopName); first-wins like buildPricingContext.
  const itemIndex = new Map<string, { shopKey: string; listing: ShopItemListing; shopName: string }>();
  for (const file of fs.readdirSync(SHOP_DIR).filter(f => f.endsWith('.yaml'))) {
    const shopKey = file.replace(/\.yaml$/, '');
    let config;
    try { config = loadShop(shopKey, SHOP_DIR); }
    catch { continue; }
    for (const listing of config.items) {
      if (!itemIndex.has(listing.id)) itemIndex.set(listing.id, { shopKey, listing, shopName: config.name });
    }
  }
  const craftedIndex = new Map<string, Recipe>();
  for (const recipe of loadAllRecipes(RECIPES_DIR)) {
    if (recipe.output.id && !craftedIndex.has(recipe.output.id)) craftedIndex.set(recipe.output.id, recipe);
  }

  // Same commodity/valuable classification as /api/info/market.
  const categoryMemo = new Map<string, 'commodity' | 'valuable'>();
  function categoryOf(itemId: string, visited = new Set<string>()): 'commodity' | 'valuable' {
    if (categoryMemo.has(itemId)) return categoryMemo.get(itemId)!;
    if (visited.has(itemId)) return 'commodity';
    visited.add(itemId);
    const recipe = craftedIndex.get(itemId);
    let cat: 'commodity' | 'valuable';
    if (recipe) {
      cat = 'commodity';
      for (const ingr of recipe.ingredients) {
        const ingrId = ingr.item_id ?? ingr.weapon_id;
        if (ingrId && categoryOf(ingrId, visited) === 'valuable') { cat = 'valuable'; break; }
      }
    } else {
      cat = ITEMS[itemId]?.type === 'valuable' ? 'valuable' : 'commodity';
    }
    categoryMemo.set(itemId, cat);
    visited.delete(itemId);
    return cat;
  }

  // Ticks in window, grouped per item ascending by time.
  const ticks = await prisma.shopPriceTick.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } });
  const byItem = new Map<string, { t: number; x: number; stock: number }[]>();
  for (const tk of ticks) {
    if (!byItem.has(tk.item_id)) byItem.set(tk.item_id, []);
    byItem.get(tk.item_id)!.push({ t: tk.at.getTime(), x: tk.x, stock: tk.stock });
  }

  // Carry-forward demand state: the most recent tick of itemId at-or-before t
  // (falls back to the earliest tick if t predates all of them).
  function stateAt(itemId: string, t: number): { x: number; stock: number } | null {
    const arr = byItem.get(itemId);
    if (!arr || arr.length === 0) return null;
    let chosen = arr[0];
    for (const p of arr) { if (p.t <= t) chosen = p; else break; }
    return chosen;
  }

  const priceMemo = new Map<string, number | null>();
  function priceAt(itemId: string, side: 'buy' | 'sell', t: number, visited = new Set<string>()): number | null {
    const key = `${itemId}:${side}:${t}`;
    if (priceMemo.has(key)) return priceMemo.get(key)!;
    if (visited.has(itemId)) return null;
    visited.add(itemId);

    const entry = itemIndex.get(itemId);
    if (!entry) { priceMemo.set(key, null); visited.delete(itemId); return null; }
    const st = stateAt(itemId, t);
    const recipe = craftedIndex.get(itemId);

    let price: number | null;
    if (recipe) {
      const mult = st
        ? effectiveCraftedMultiplier(entry.listing, st.x, st.stock)
        : (CRAFTED_MULT_MIN + CRAFTED_MULT_MAX) / 2;
      let inputCost = 0;
      for (const ingr of recipe.ingredients) {
        const ingrId = ingr.item_id ?? ingr.weapon_id;
        if (!ingrId) { priceMemo.set(key, null); visited.delete(itemId); return null; }
        const ip = priceAt(ingrId, side, t, visited);
        if (ip == null) { priceMemo.set(key, null); visited.delete(itemId); return null; }
        inputCost += ip * ingr.quantity;
      }
      price = (inputCost / (recipe.output.quantity ?? 1)) * mult;
    } else {
      const mult = st ? effectiveMultiplier(entry.listing, st.x, st.stock) : 1.0;
      const base = side === 'buy' ? entry.listing.base_buy : entry.listing.base_sell;
      price = base == null ? null : base * mult;
    }
    priceMemo.set(key, price);
    visited.delete(itemId);
    return price;
  }

  // The expected price band shown on the Market page (raw = base × [0.25, 4],
  // crafted = input-range × crafted band). Charts use this as their fixed
  // y-axis so the current price's position within its range is legible.
  const ctx = buildPricingContext(SHOP_DIR, RECIPES_DIR);
  const roundRange = (r: { min: number; max: number } | null) =>
    r ? { min: Math.round(r.min), max: Math.round(r.max) } : null;

  const series = [];
  const shopsSeen = new Map<string, string>();
  for (const [itemId, pts] of byItem) {
    const entry = itemIndex.get(itemId);
    if (!entry || isUnlock(itemId)) continue;
    shopsSeen.set(entry.shopKey, entry.shopName);
    const recipe = craftedIndex.get(itemId);
    const weaponYaml = ITEMS[itemId] ? null : loadWeaponYaml(itemId, __dirname);
    const itemName = ITEMS[itemId]?.name ?? (weaponYaml?.Name as string | undefined) ?? itemId;
    const points = pts.map(p => {
      const buy  = priceAt(itemId, 'buy',  p.t);
      const sell = priceAt(itemId, 'sell', p.t);
      return { t: p.t, buy: buy == null ? null : Math.round(buy), sell: sell == null ? null : Math.round(sell) };
    });
    const [rangeBuy, rangeSell] = await Promise.all([
      ctx.currentRange(itemId, 'buy'),
      ctx.currentRange(itemId, 'sell'),
    ]);
    series.push({
      shop_id:    entry.shopKey,
      shop_name:  entry.shopName,
      item_id:    itemId,
      item_name:  itemName,
      category:   categoryOf(itemId),
      source:     recipe ? 'recipe' : 'raw',
      base_buy:   recipe ? null : (entry.listing.base_buy ?? null),
      base_sell:  recipe ? null : (entry.listing.base_sell ?? null),
      range_buy:  roundRange(rangeBuy),
      range_sell: roundRange(rangeSell),
      points,
    });
  }
  series.sort((a, b) => a.item_name.localeCompare(b.item_name));

  res.json({
    days,
    generated_at: new Date().toISOString(),
    shops: [...shopsSeen.entries()].map(([id, name]) => ({ id, name })),
    series,
  });
});

// ---- Dev Stats ----
// Pre-0.2.0 rows have NULL version/weapon_key; they bucket under these labels
// in the filter UI so legacy data stays selectable instead of disappearing.
// Bucket label for BattleLog rows that predate the version column (added
// in 0.1.6). The column was first stamped in 0.1.6, so anything with NULL
// version is genuinely "before 0.1.6". Update this string if the labelling
// regime changes.
const PRE_VERSION_LABEL = 'pre-0.1.6';
const UNKNOWN_WEAPON_LABEL = 'unknown';

function loadWeaponNames(): Record<string, string> {
  const dir = join(__dirname, '../../database/weapons');
  const out: Record<string, string> = {};
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
    const key = file.replace('.yaml', '');
    try {
      const raw = yaml.load(fs.readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>;
      const weapon = (raw['Weapon'] as Record<string, unknown> | undefined);
      out[key] = (weapon?.['Name'] as string) ?? key;
    } catch { out[key] = key; }
  }
  return out;
}

function loadEnemyNames(): Record<string, string> {
  const dir = join(__dirname, '../../database/enemies');
  const out: Record<string, string> = {};
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
    const key = file.replace('.yaml', '');
    try {
      const raw = yaml.load(fs.readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>;
      out[key] = (raw['Name'] as string) ?? key;
    } catch { out[key] = key; }
  }
  return out;
}

function loadSimForVersion(version: string): unknown | null {
  // Canonical spatial matrix, regenerated on version bump (npm run matrix:save)
  // and committed under docs/sim/. We only render it on the dev environment
  // because numbers
  // change with balance tuning and showing them on prod would confuse players
  // who can see anything routed through the auth-gated APIs in the browser.
  if (process.env.NODE_ENV === 'production') return null;
  const path = join(__dirname, `../../docs/sim/${version}.json`);
  if (!fs.existsSync(path)) return null;
  try { return JSON.parse(fs.readFileSync(path, 'utf-8')); } catch { return null; }
}

app.get('/api/dev/stats', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!isDev(discordId)) { res.status(403).json({ error: 'Forbidden' }); return; }

  const parseList = (v: unknown): string[] | null => {
    if (typeof v !== 'string' || v.trim() === '') return null;
    return v.split(',').map(s => s.trim()).filter(Boolean);
  };
  const enemyFilter   = parseList(req.query.enemies);
  const weaponFilter  = parseList(req.query.weapons);
  const versionFilter = parseList(req.query.versions);

  // BattleLog rows are tiny (~10 scalar cols, no joins). Even after a year of
  // play this stays well under a megabyte, so we pull everything once and
  // aggregate in JS — keeps the filter logic simple and the SQL boring.
  // first_mover filter: 'player' / 'enemy' / absent (= either, no filter).
  const firstMoverFilter = (() => {
    const v = req.query.first_mover;
    if (v === 'player' || v === 'enemy') return v;
    return null;
  })();

  const rows = await prisma.battleLog.findMany({
    select: {
      enemy: true, outcome: true, korel_delta: true, version: true, weapon_key: true,
      weapon_upgrades: true,
      started_at: true, ended_at: true,
      player_hp_left: true, enemy_hp_left: true,
      damage_dealt: true, damage_received: true, rounds_count: true,
      crit_count: true, aimed_attempted: true, aimed_hit: true, restores: true,
      player_went_first: true,
    },
  });

  // A weapon's identity in the stats is its key + effective level: base level +
  // floor(player upgrades / 3), since 3 upgrades = a weapon level. So an upgraded
  // Deck of Cards shows separately as "Deck of Cards · L2", "· L3", etc.
  const enemyNames  = loadEnemyNames();
  const weaponNames = loadWeaponNames();
  weaponNames[UNKNOWN_WEAPON_LABEL] = 'Unknown';
  const weaponBaseLevels = new Map<string, number>();
  const baseLevelOf = (wk: string): number => {
    if (!weaponBaseLevels.has(wk)) weaponBaseLevels.set(wk, loadWeaponYaml(wk, __dirname)?.Level ?? 1);
    return weaponBaseLevels.get(wk)!;
  };
  const weaponLabels = new Map<string, string>();   // composite key → display name
  const weaponIdentity = (weaponKey: string | null, upgrades: number | null): string => {
    const wk = weaponKey ?? UNKNOWN_WEAPON_LABEL;
    if (wk === UNKNOWN_WEAPON_LABEL) { weaponLabels.set(wk, weaponNames[wk]); return wk; }
    const lvl = baseLevelOf(wk) + Math.floor((upgrades ?? 0) / 3);
    const key = `${wk}@L${lvl}`;
    if (!weaponLabels.has(key)) weaponLabels.set(key, `${weaponNames[wk] ?? wk} · L${lvl}`);
    return key;
  };

  const seenVersions = new Set<string>();
  const seenWeapons  = new Set<string>();
  const seenEnemies  = new Set<string>();
  for (const r of rows) {
    seenVersions.add(r.version ?? PRE_VERSION_LABEL);
    seenWeapons.add(weaponIdentity(r.weapon_key, r.weapon_upgrades));
    seenEnemies.add(r.enemy);
  }

  const filtered = rows.filter(r => {
    const v = r.version ?? PRE_VERSION_LABEL;
    const w = weaponIdentity(r.weapon_key, r.weapon_upgrades);
    if (enemyFilter   && !enemyFilter.includes(r.enemy)) return false;
    if (weaponFilter  && !weaponFilter.includes(w))      return false;
    if (versionFilter && !versionFilter.includes(v))     return false;
    if (firstMoverFilter === 'player' && r.player_went_first !== true)  return false;
    if (firstMoverFilter === 'enemy'  && r.player_went_first !== false) return false;
    return true;
  });

  const enemyHistogram:  Record<string, number> = {};
  const weaponHistogram: Record<string, number> = {};
  // Build a flat matchup table first, then pivot into per-enemy and per-weapon
  // groupings. Keeping one source of truth means the two views can't drift —
  // toggling Group By on the client is a pure presentation change.
  type Cell = {
    total: number; wins: number; forfeits: number;
    // Sums + counts so we can take averages that ignore legacy NULL columns.
    // Each metric has its own denominator because different metrics are
    // populated on different rows: hp_left only on wins, enemy_hp_left only
    // on losses, DPR/DTR only on rows with rounds_count, etc.
    hp_left_sum: number; hp_left_n: number;
    enemy_hp_left_sum: number; enemy_hp_left_n: number;
    dpr_sum: number; dpr_n: number;
    dtr_sum: number; dtr_n: number;
    crit_sum: number; crit_n: number;
    aimed_attempted_sum: number; aimed_hit_sum: number;
    restores_sum: number; restores_n: number;
    duration_sum: number; duration_n: number;
  };
  function newCell(): Cell {
    return {
      total: 0, wins: 0, forfeits: 0,
      hp_left_sum: 0, hp_left_n: 0,
      enemy_hp_left_sum: 0, enemy_hp_left_n: 0,
      dpr_sum: 0, dpr_n: 0,
      dtr_sum: 0, dtr_n: 0,
      crit_sum: 0, crit_n: 0,
      aimed_attempted_sum: 0, aimed_hit_sum: 0,
      restores_sum: 0, restores_n: 0,
      duration_sum: 0, duration_n: 0,
    };
  }
  const matchup: Record<string, Record<string, Cell>> = {};

  for (const r of filtered) {
    const w = weaponIdentity(r.weapon_key, r.weapon_upgrades);
    enemyHistogram[r.enemy] = (enemyHistogram[r.enemy] ?? 0) + 1;
    weaponHistogram[w]      = (weaponHistogram[w] ?? 0) + 1;
    const byW = matchup[r.enemy] ??= {};
    const c   = byW[w] ??= newCell();
    c.total += 1;
    if (r.outcome === 'win')     c.wins += 1;
    if (r.outcome === 'forfeit') c.forfeits += 1;
    if (r.outcome === 'win' && r.player_hp_left != null) {
      c.hp_left_sum += r.player_hp_left;
      c.hp_left_n   += 1;
    }
    if (r.outcome === 'loss' && r.enemy_hp_left != null) {
      c.enemy_hp_left_sum += r.enemy_hp_left;
      c.enemy_hp_left_n   += 1;
    }
    if (r.rounds_count != null && r.rounds_count > 0) {
      if (r.damage_dealt != null) {
        c.dpr_sum += r.damage_dealt / r.rounds_count;
        c.dpr_n   += 1;
      }
      if (r.damage_received != null) {
        c.dtr_sum += r.damage_received / r.rounds_count;
        c.dtr_n   += 1;
      }
    }
    if (r.crit_count != null) {
      c.crit_sum += r.crit_count;
      c.crit_n   += 1;
    }
    if (r.aimed_attempted != null && r.aimed_hit != null) {
      c.aimed_attempted_sum += r.aimed_attempted;
      c.aimed_hit_sum       += r.aimed_hit;
    }
    if (r.restores != null) {
      c.restores_sum += r.restores;
      c.restores_n   += 1;
    }
    if (r.ended_at && r.started_at) {
      const dur = (r.ended_at.getTime() - r.started_at.getTime()) / 1000;
      if (dur > 0 && dur < 60 * 60 * 24) { // skip absurd outliers
        c.duration_sum += dur;
        c.duration_n   += 1;
      }
    }
  }

  const weaponName = (wk: string): string => weaponLabels.get(wk) ?? wk;

  type Row = {
    key: string; name: string;
    total: number; wins: number; forfeits: number; win_rate: number;
    avg_hp_left: number | null; avg_enemy_hp_left: number | null;
    avg_dpr: number | null; avg_dtr: number | null;
    avg_crits: number | null; aimed_hit_rate: number | null;
    avg_restores: number | null; avg_duration_s: number | null;
  };
  function row(key: string, name: string, c: Cell): Row {
    return {
      key, name,
      total:             c.total,
      wins:              c.wins,
      forfeits:          c.forfeits,
      win_rate:          c.total > 0 ? c.wins / c.total : 0,
      avg_hp_left:       c.hp_left_n        > 0 ? c.hp_left_sum        / c.hp_left_n        : null,
      avg_enemy_hp_left: c.enemy_hp_left_n  > 0 ? c.enemy_hp_left_sum  / c.enemy_hp_left_n  : null,
      avg_dpr:           c.dpr_n            > 0 ? c.dpr_sum            / c.dpr_n            : null,
      avg_dtr:           c.dtr_n            > 0 ? c.dtr_sum            / c.dtr_n            : null,
      avg_crits:         c.crit_n           > 0 ? c.crit_sum           / c.crit_n           : null,
      aimed_hit_rate:    c.aimed_attempted_sum > 0 ? c.aimed_hit_sum / c.aimed_attempted_sum : null,
      avg_restores:      c.restores_n       > 0 ? c.restores_sum       / c.restores_n       : null,
      avg_duration_s:    c.duration_n       > 0 ? c.duration_sum       / c.duration_n       : null,
    };
  }
  function groupTotals(cells: Cell[]): Cell {
    return cells.reduce((a, b) => ({
      total:               a.total + b.total,
      wins:                a.wins + b.wins,
      forfeits:            a.forfeits + b.forfeits,
      hp_left_sum:         a.hp_left_sum + b.hp_left_sum,
      hp_left_n:           a.hp_left_n + b.hp_left_n,
      enemy_hp_left_sum:   a.enemy_hp_left_sum + b.enemy_hp_left_sum,
      enemy_hp_left_n:     a.enemy_hp_left_n + b.enemy_hp_left_n,
      dpr_sum:             a.dpr_sum + b.dpr_sum,
      dpr_n:               a.dpr_n + b.dpr_n,
      dtr_sum:             a.dtr_sum + b.dtr_sum,
      dtr_n:               a.dtr_n + b.dtr_n,
      crit_sum:            a.crit_sum + b.crit_sum,
      crit_n:              a.crit_n + b.crit_n,
      aimed_attempted_sum: a.aimed_attempted_sum + b.aimed_attempted_sum,
      aimed_hit_sum:       a.aimed_hit_sum + b.aimed_hit_sum,
      restores_sum:        a.restores_sum + b.restores_sum,
      restores_n:          a.restores_n + b.restores_n,
      duration_sum:        a.duration_sum + b.duration_sum,
      duration_n:          a.duration_n + b.duration_n,
    }), newCell());
  }

  const perEnemy = Object.entries(matchup).map(([enemyKey, byW]) => {
    const cells = Object.values(byW);
    const totals = groupTotals(cells);
    return {
      ...row(enemyKey, enemyNames[enemyKey] ?? enemyKey, totals),
      breakdown: Object.entries(byW).map(([wk, c]) => row(wk, weaponName(wk), c)).sort((a, b) => b.total - a.total),
    };
  }).sort((a, b) => b.total - a.total);

  // Same data, pivoted: outer key is weapon, inner breakdown is enemy.
  const byWeapon: Record<string, Record<string, Cell>> = {};
  for (const [ek, byW] of Object.entries(matchup)) {
    for (const [wk, c] of Object.entries(byW)) {
      (byWeapon[wk] ??= {})[ek] = c;
    }
  }
  const perWeapon = Object.entries(byWeapon).map(([weaponKey, byE]) => {
    const cells = Object.values(byE);
    const totals = groupTotals(cells);
    return {
      ...row(weaponKey, weaponName(weaponKey), totals),
      breakdown: Object.entries(byE).map(([ek, c]) => row(ek, enemyNames[ek] ?? ek, c)).sort((a, b) => b.total - a.total),
    };
  }).sort((a, b) => b.total - a.total);

  res.json({
    available: {
      enemies:  [...seenEnemies].sort().map(k => ({ key: k, name: enemyNames[k]  ?? k })),
      weapons:  [...seenWeapons].sort().map(k => ({ key: k, name: weaponName(k) })),
      versions: [...seenVersions].sort((a, b) => a === PRE_VERSION_LABEL ? -1 : b === PRE_VERSION_LABEL ? 1 : a.localeCompare(b, undefined, { numeric: true })),
    },
    histograms: {
      enemies:  Object.entries(enemyHistogram).map(([key, count]) => ({ key, name: enemyNames[key]  ?? key, count })).sort((a, b) => b.count - a.count),
      weapons:  Object.entries(weaponHistogram).map(([key, count]) => ({ key, name: weaponName(key), count })).sort((a, b) => b.count - a.count),
    },
    per_enemy:     perEnemy,
    per_weapon:    perWeapon,
    total_battles: filtered.length,
    sim:           loadSimForVersion(APP_VERSION),
    app_version:   APP_VERSION,
  });
});

// ---- Active battles ----
// Sessions live in-memory only (sessions Map + sessionMeta Map). We don't
// persist them — bot restarts intentionally drop everything. To prevent
// stale sessions from piling up, anything that hasn't seen a submit_intent
// in 7 days gets auto-forfeited the next time a list/lookup runs.
const FORFEIT_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

async function forfeitSession(sessionId: string, reason: 'user' | 'timeout'): Promise<void> {
  const session = sessions.get(sessionId);
  const meta    = sessionMeta.get(sessionId);
  if (!session || !meta) return;
  // Tutorial forfeits don't write BattleLog (the tutorial doesn't count as a
  // real fight) — but they still get cleaned up.
  if (!meta.isTutorial) {
    const chars = await charRepo.list(meta.discordUserId).catch(() => []);
    const char = chars[0];
    if (char) {
      await logBattlePerEnemy(session, meta, char.id, 'forfeit', 0, reason === 'timeout' ? 'auto-forfeit (inactive 7d)' : null).catch(() => {});
    }
  }
  sessions.delete(sessionId);
  sessionMeta.delete(sessionId);
  io.to(sessionId).emit('game_over', { winner: null, reason: 'forfeit' });
}

// Sweep all expired sessions. Called at the top of any read that lists
// active battles, so the user can't see a stale entry that's already past
// the cutoff. Cheap — Map iteration over an in-memory collection that's
// always small in practice.
async function sweepExpiredSessions(): Promise<void> {
  const cutoff = Date.now() - FORFEIT_TIMEOUT_MS;
  for (const [id, m] of sessionMeta.entries()) {
    if (m.lastActivityAt.getTime() < cutoff) {
      await forfeitSession(id, 'timeout');
    }
  }
}

function listActiveSessions(discordId: string): Array<{ session_id: string; enemy_name: string; is_tutorial: boolean; started_at: string; last_activity_at: string; rounds: number }> {
  const out: Array<{ session_id: string; enemy_name: string; is_tutorial: boolean; started_at: string; last_activity_at: string; rounds: number }> = [];
  for (const [id, m] of sessionMeta.entries()) {
    if (m.discordUserId !== discordId) continue;
    if (m.endedAt) continue; // finished battles get hidden immediately, even though
                             // the 10-min cleanup timer keeps them in memory for the
                             // reward UI to stay rendered.
    out.push({
      session_id:       id,
      enemy_name:       m.enemyName,
      is_tutorial:      m.isTutorial,
      started_at:       m.startedAt.toISOString(),
      last_activity_at: m.lastActivityAt.toISOString(),
      rounds:           m.rounds.filter(r => r.turn > 0).length,
    });
  }
  // Tutorial first (so it stays anchored), then most-recent activity at top.
  out.sort((a, b) => {
    if (a.is_tutorial !== b.is_tutorial) return a.is_tutorial ? -1 : 1;
    return b.last_activity_at.localeCompare(a.last_activity_at);
  });
  return out;
}

app.get('/api/active-battles', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  await sweepExpiredSessions();
  res.json({ battles: listActiveSessions(discordId) });
});

app.post('/api/active-battles/:sessionId/forfeit', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const sessionId = String(req.params.sessionId);
  const meta = sessionMeta.get(sessionId);
  if (!meta || meta.discordUserId !== discordId) {
    res.status(404).json({ error: 'No such battle.' });
    return;
  }
  await forfeitSession(sessionId, 'user');
  res.json({ ok: true });
});

// ---- Hunt ----

function loadEnemySummary(enemyKey: EnemyKey): { name: string; health: number; drops: Array<{ item_id: string; name: string; type: string; field: number[] }> } | null {
  const path = join(__dirname, `../../database/enemies/${enemyKey}.yaml`);
  if (!fs.existsSync(path)) return null;
  const raw = yaml.load(fs.readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const loot = (raw['Loot'] as { Items?: Array<{ id: string; type: string; Field: number[] }> } | undefined)?.Items ?? [];
  const drops = loot.map(d => ({
    item_id: d.id,
    name:    ITEMS[d.id]?.name ?? d.id,
    type:    d.type,
    field:   d.Field ?? [],
  }));
  return { name: raw['Name'] as string, health: raw['Health'] as number, drops };
}

app.get('/api/hunt', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const dbUser = await prisma.user.findUnique({ where: { discord_id: discordId } });
  const tutorialComplete = !!dbUser?.tutorial_complete;

  const baitRows = await prisma.inventoryItem.findMany({
    where: { character_id: char.id, item_id: { in: BAIT_ITEM_IDS } },
  });
  const owned = baitRows.filter(r => r.quantity > 0);

  const baits = owned.map(r => {
    const enemyKey = BAIT_TO_ENEMY[r.item_id];
    const enemy    = loadEnemySummary(enemyKey);
    return {
      bait_id:   r.item_id,
      bait_name: ITEMS[r.item_id]?.name ?? r.item_id,
      quantity:  r.quantity,
      enemy_key:    enemyKey,
      enemy_name:   enemy?.name ?? enemyKey,
      enemy_health: enemy?.health ?? 0,
      enemy_sprite: `${HOST}/sprites/${enemyKey}.png`,
      drops:        enemy?.drops ?? [],
    };
  }).sort((a, b) => a.enemy_health - b.enemy_health);

  res.json({ baits, tutorial_complete: tutorialComplete, is_dev: isDev(discordId) });
});

app.post('/api/hunt/start', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { bait_id } = req.body ?? {};
  if (typeof bait_id !== 'string' || !(bait_id in BAIT_TO_ENEMY)) {
    res.status(400).json({ error: 'Invalid bait' });
    return;
  }
  const enemyKey = BAIT_TO_ENEMY[bait_id];

  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const dbUser = await prisma.user.findUnique({ where: { discord_id: discordId } });
  if (!dbUser?.tutorial_complete) {
    res.status(403).json({ error: 'Finish the tutorial first — use /battle to talk to Fendalok.' });
    return;
  }

  const baitIsUnlock = isUnlock(bait_id);
  const consumed = await prisma.$transaction(async tx => {
    const inv = await tx.inventoryItem.findUnique({
      where: { character_id_item_id: { character_id: char.id, item_id: bait_id } },
    });
    if (!inv || inv.quantity < 1) return false;
    // Unlock items aren't consumed — owning one is the permit, not a charge.
    if (baitIsUnlock) return true;
    if (inv.quantity === 1) {
      await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: char.id, item_id: bait_id } } });
    } else {
      await tx.inventoryItem.update({
        where: { character_id_item_id: { character_id: char.id, item_id: bait_id } },
        data: { quantity: { decrement: 1 } },
      });
    }
    return true;
  });
  if (!consumed) { res.status(400).json({ error: "You don't have that bait." }); return; }

  const playerSprite = char.sprite_token ? `${HOST}/sprites/${char.sprite_token}.png` : undefined;
  const sessionId    = Math.random().toString(36).slice(2, 10);
  const equipped     = await equippedWeaponForCombat(char);
  const weaponKey    = equipped?.key ?? 'branch';
  // Roll for a second enemy: 2.3% on real hunts, force-2 if the client passed
  // it AND the user is a dev. Dev override exists so we can reliably test the
  // multi-enemy code without waiting on a rare random spawn.
  const wantsForceTwo = req.body?.count === 2;
  const isDevUser     = isDev(discordId);
  let enemyCount: number;
  if (wantsForceTwo && isDevUser) enemyCount = 2;
  else                            enemyCount = Math.random() < 0.023 ? 2 : 1;

  const { session: huntSession, lootTables, enemyName } = createSession(sessionId, enemyKey, playerSprite, char.name, weaponKey, false, equipped?.upgrades, enemyCount);
  sessions.set(sessionId, huntSession);
  // Persist initiative rolls as a synthetic round 0 so the battle log table
  // captures them alongside the per-turn rounds.
  const rounds: { turn: number; log: string[] }[] = huntSession.initiativeLog.length > 0
    ? [{ turn: 0, log: huntSession.initiativeLog }]
    : [];
  const now = new Date();
  // Player upgrade count on the equipped weapon (each = +1; 3 = a weapon level) —
  // recorded per battle so the stats page can split a weapon by effective level.
  const weaponUpgrades = (equipped?.upgrades as { upgradesDone?: number } | undefined)?.upgradesDone ?? 0;
  sessionMeta.set(sessionId, { discordUserId: discordId, isTutorial: false, lootTables, enemyKey, enemyName, weaponKey, weaponUpgrades, startedAt: now, lastActivityAt: now, endedAt: null, rounds });

  res.json({ session_url: `/battle/${sessionId}` });
});

app.get('/api/character', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const [weapons, dbUser, profRows] = await Promise.all([
    prisma.characterWeapon.findMany({ where: { character_id: char.id }, orderBy: { created_at: 'asc' } }),
    prisma.user.findUnique({ where: { discord_id: discordId } }),
    prisma.characterProfession.findMany({ where: { character_id: char.id } }),
  ]);
  const weaponList = weapons.map(w => {
    const raw = loadWeaponYaml(w.weapon_key, __dirname) as Record<string, unknown> | null;
    return {
      id:          w.id,
      weapon_key:  w.weapon_key,
      name:        (raw?.['Name']        as string | undefined) ?? w.weapon_key,
      description: (raw?.['Description'] as string | undefined) ?? '',
      hp:          (raw?.['HP']          as number | undefined) ?? 0,
      level:       (raw?.['Level']       as number | undefined) ?? 0,
      equipped:    w.id === char.equipped_weapon_id,
      bonus_count: weaponBonusCount(w.weapon_key, w.upgrades),
    };
  }).sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name));

  const profLevels: Record<string, number> = {};
  for (const p of profRows) profLevels[p.profession] = p.level;
  const combined = profRows.reduce((sum, p) => sum + p.level, 0);

  res.json({
    id:           char.id,
    name:         char.name,
    nationality:  char.nationality,
    bio:          char.bio,
    sprite_token: char.sprite_token,
    sprite_cdn:   worldConfig.sprite_cdn,
    health:       char.health,
    max_health:   char.max_health,
    equipped_weapon_id: char.equipped_weapon_id,
    weapons:      weaponList,
    korel:        dbUser?.korel ?? 0,
    professions: Object.fromEntries(
      PROFESSIONS.map(p => [p, {
        label:    PROFESSION_NAMES[p],
        level:    profLevels[p] ?? 0,
        maxLevel: PROFESSION_MAX_LEVEL,
        nextCost: (profLevels[p] ?? 0) < PROFESSION_MAX_LEVEL ? levelCost(combined) : null,
      }])
    ),
  });
});

app.post('/api/character/equip', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { weapon_id } = req.body as { weapon_id?: string };
  if (!weapon_id) { res.status(400).json({ error: 'weapon_id required' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];
  const owned = await prisma.characterWeapon.findUnique({ where: { id: weapon_id } });
  if (!owned || owned.character_id !== char.id) {
    res.json({ success: false, message: "You don't own that weapon." });
    return;
  }
  const raw = loadWeaponYaml(owned.weapon_key, __dirname) as Record<string, unknown> | null;
  const maxHp = (raw?.['HP'] as number | undefined) ?? char.max_health;
  await prisma.character.update({
    where: { id: char.id },
    data:  { equipped_weapon_id: weapon_id, max_health: maxHp, health: maxHp },
  });
  const weaponName = (raw?.['Name'] as string | undefined) ?? owned.weapon_key;
  await prisma.eventLog.create({ data: {
    discord_id: discordId, event_type: 'weapon_equipped',
    payload: { weapon_id, weapon_key: owned.weapon_key, weapon_name: weaponName },
  }}).catch(() => {});
  res.json({ success: true, message: `Equipped ${weaponName}.` });
});

app.get('/api/sprites', async (_req: Request, res: Response) => {
  res.json({
    sprites:   SPRITES,
    spriteCdn: worldConfig.sprite_cdn,
  });
});

app.post('/api/character/create', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { name, bio, nationality, sprite_key } = req.body as {
    name?: string; bio?: string; nationality?: string; sprite_key?: string;
  };
  if (typeof name !== 'string' || typeof nationality !== 'string' || typeof sprite_key !== 'string') {
    res.status(400).json({ error: 'name, nationality, and sprite_key required' }); return;
  }
  const result = await bootstrapNewCharacter(discordId, {
    name: name.trim(),
    bio:  typeof bio === 'string' ? bio.trim() || undefined : undefined,
    nationality: nationality as Nationality,
    spriteKey:   sprite_key,
  });
  if (!result.ok) {
    res.json({ success: false, message: result.error });
    return;
  }
  res.json({ success: true, session_url: result.sessionUrl });
});

app.get('/api/players', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const q = String(req.query.q ?? '').trim();
  if (q.length === 0) { res.json({ players: [] }); return; }
  const chars = await prisma.character.findMany({
    where: {
      name: { contains: q, mode: 'insensitive' },
      NOT:  { discord_id: discordId },
    },
    take: 12,
    orderBy: { name: 'asc' },
  });
  res.json({
    players: chars.map(c => ({
      name:        c.name,
      discord_id:  c.discord_id,
      nationality: c.nationality,
    })),
  });
});

app.post('/api/trade/start', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const { target_discord_id } = req.body as { target_discord_id?: string };
  if (!target_discord_id) { res.status(400).json({ error: 'target_discord_id required' }); return; }
  const result = await createTradeSession(discordId, target_discord_id);
  if (!result.ok) { res.json({ success: false, message: result.error }); return; }

  let dmStatus: 'sent' | 'failed' | 'no-bot' = 'no-bot';
  if (discord) {
    try {
      const user = await discord.users.fetch(target_discord_id);
      await user.send(`**${result.initiatorCharName}** wants to trade with you!\n${HOST}/app/trade/${result.tradeId}?auth=${result.targetToken}`);
      dmStatus = 'sent';
    } catch (_) { dmStatus = 'failed'; }
  }

  res.json({
    success:        true,
    trade_id:       result.tradeId,
    target_name:    result.targetCharName,
    dm_status:      dmStatus,
    target_link:    `${HOST}/app/trade/${result.tradeId}?auth=${result.targetToken}`,
  });
});

app.get('/api/inventory', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const [items, weapons, user] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { character_id: char.id }, include: { item: true } }),
    prisma.characterWeapon.findMany({ where: { character_id: char.id }, orderBy: { created_at: 'asc' } }),
    prisma.user.findUnique({ where: { discord_id: discordId } }),
  ]);

  // Trophy enrichment: each unlock item ending in '_trophy' shows a live
  // "defeated N times" count from BattleLog. Batched as one groupBy query
  // so the cost is constant regardless of how many trophies the player has.
  const trophyIds      = items.map(i => i.item_id).filter(id => ITEMS[id]?.type === 'unlock' && enemyKeyFromTrophy(id) !== null);
  const trophyEnemyMap = new Map<string, string>(); // trophyId → enemyName for the BattleLog lookup
  for (const id of trophyIds) {
    const ek = enemyKeyFromTrophy(id);
    if (!ek) continue;
    const summary = loadEnemySummary(ek as EnemyKey);
    if (summary) trophyEnemyMap.set(id, summary.name);
  }
  const enemyNames = [...trophyEnemyMap.values()];
  const winCounts  = enemyNames.length > 0
    ? await prisma.battleLog.groupBy({
        by: ['enemy'],
        where: { character_id: char.id, outcome: 'win', enemy: { in: enemyNames } },
        _count: { enemy: true },
      })
    : [];
  const winsByEnemy = new Map(winCounts.map(c => [c.enemy, c._count.enemy]));

  const itemList = items.map(i => {
    const enemyName     = trophyEnemyMap.get(i.item_id);
    const defeatedCount = enemyName ? (winsByEnemy.get(enemyName) ?? 0) : undefined;
    return {
      item_id:        i.item_id,
      name:           ITEMS[i.item_id]?.name        ?? i.item.name,
      description:    ITEMS[i.item_id]?.description ?? i.item.description,
      type:           ITEMS[i.item_id]?.type        ?? 'material',
      quantity:       i.quantity,
      defeated_count: defeatedCount,
    };
  });

  const weaponList = weapons.map(w => {
    const raw = loadWeaponYaml(w.weapon_key, __dirname) as Record<string, unknown> | null;
    return {
      id:          w.id,
      weapon_key:  w.weapon_key,
      name:        (raw?.['Name'] as string | undefined) ?? w.weapon_key,
      equipped:    w.id === char.equipped_weapon_id,
      bonus_count: weaponBonusCount(w.weapon_key, w.upgrades),
    };
  });

  // Quest trophies — the player's participation in completed global quests
  // (rank-tiered on the stats page: 1st gold / 2nd silver / 3rd copper / else grey).
  const questDeposits = await prisma.questDeposit.findMany({
    where:   { character_id: char.id, quest: { status: 'completed' } },
    include: { quest: true },
    orderBy: { quest: { ends_at: 'desc' } },
  });
  const questTrophies = questDeposits.map(d => ({
    quest_id:  d.quest_id,
    name:      d.quest.name,
    lore:      d.quest.lore,
    item_name: ITEMS[d.quest.item_id]?.name ?? d.quest.item_id,
    quantity:  d.quantity,
    rank:      d.rank,
  }));

  res.json({
    characterName: char.name,
    equipped_weapon_id: char.equipped_weapon_id,
    korel:   user?.korel ?? 0,
    items:   itemList,
    weapons: weaponList,
    quest_trophies: questTrophies,
  });
});

app.get('/api/layout', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.json({ authenticated: false }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.json({ authenticated: false }); return; }
  const char = chars[0];

  const [dbUser, profRows] = await Promise.all([
    prisma.user.findUnique({ where: { discord_id: discordId } }),
    prisma.characterProfession.findMany({ where: { character_id: char.id } }),
  ]);
  const profLevels: Record<string, number> = {};
  for (const p of profRows) profLevels[p.profession] = p.level;
  const combined = profRows.reduce((sum, p) => sum + p.level, 0);

  // Tutorial resilience: if the player has a character but never finished
  // the tutorial AND nothing is in memory for them (closed tab, bot restart,
  // 7-day timeout), spin up a fresh tutorial session. The client redirects
  // to it on app init. Resume-in-progress is also a valid outcome here —
  // findActiveTutorialSession returns the existing id if one's still alive.
  let tutorialSessionId: string | null = null;
  if (!dbUser?.tutorial_complete) {
    tutorialSessionId = findActiveTutorialSession(discordId) ?? startTutorialSession(discordId, char.sprite_token);
  }

  res.json({
    authenticated: true,
    characterName: char.name,
    spriteToken:   char.sprite_token,
    spriteCdn:     worldConfig.sprite_cdn,
    korel:         dbUser?.korel ?? 0,
    is_dev:        isDev(discordId),
    tutorial_session_id: tutorialSessionId,
    professions: Object.fromEntries(
      PROFESSIONS.map(p => [p, {
        label:    PROFESSION_NAMES[p],
        level:    profLevels[p] ?? 0,
        maxLevel: PROFESSION_MAX_LEVEL,
        nextCost: (profLevels[p] ?? 0) < PROFESSION_MAX_LEVEL ? levelCost(combined) : null,
      }])
    ),
  });
});

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function resolveAuth(req: Request): string | null {
  const cookieToken = parseCookies(req.headers.cookie)['idya_session'];
  if (cookieToken && authTokens.has(cookieToken)) {
    return authTokens.get(cookieToken)?.discordUserId ?? null;
  }
  return null;
}

function resolveSocketAuth(socket: Socket): string | null {
  const cookieToken = parseCookies(socket.handshake.headers.cookie)['idya_session'];
  if (cookieToken && authTokens.has(cookieToken)) {
    return authTokens.get(cookieToken)?.discordUserId ?? null;
  }
  return null;
}

app.post('/api/auth/claim', (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token || !authTokens.has(token)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = 30 * 24 * 60 * 60; // 30 days in seconds
  const parts = [
    `idya_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
  res.json({ ok: true });
});

function validShop(key: string): boolean {
  return fs.existsSync(join(SHOP_DIR, `${key}.yaml`));
}

async function pingChannel(channelId: string | undefined, msg: string): Promise<void> {
  if (!discord || !channelId) return;
  try {
    const ch = await discord.channels.fetch(channelId);
    if (ch?.isTextBased() && 'send' in ch)
      await (ch as import('discord.js').TextChannel).send(msg);
  } catch (err) { console.error('Ping failed:', err); }
}

const PROFESSION_CHANNEL: Partial<Record<string, string>> = {
  lumberjack: worldConfig.channels.lumberjack,
  blacksmith:  worldConfig.channels.blacksmith,
  enchanter:   worldConfig.channels.enchanting_shop,
};

app.get('/shop/:shopKey', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../../public/shop.html'));
});

app.get('/api/shop/:shopKey', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const shopKey = String(req.params.shopKey);
  if (!validShop(shopKey)) { res.status(404).json({ error: 'Shop not found' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const config    = loadShop(shopKey, SHOP_DIR);
  const prices    = await getPrices(shopKey, config);
  const dbUser    = await prisma.user.findUnique({ where: { discord_id: discordId } });
  const dbItems   = await prisma.item.findMany({ where: { id: { in: prices.map(p => p.id) } } });
  const inventory = await prisma.inventoryItem.findMany({
    where: { character_id: chars[0].id },
    include: { item: true },
  });

  const profKey  = SHOP_TO_PROFESSION[shopKey];
  let training: { profession: string; label: string; level: number; maxLevel: number; nextCost: number | null } | null = null;
  if (profKey) {
    const prof = await prisma.characterProfession.findUnique({
      where: { character_id_profession: { character_id: chars[0].id, profession: profKey } },
    });
    const level    = prof?.level ?? 0;
    const combined = await getCombinedLevel(chars[0].id);
    training = {
      profession: profKey,
      label:      PROFESSION_NAMES[profKey],
      level,
      maxLevel:   PROFESSION_MAX_LEVEL,
      nextCost:   level < PROFESSION_MAX_LEVEL ? levelCost(combined) : null,
    };
  }

  // Split shop entries: items have shop stock; weapons are unique instances we look up.
  const itemPrices   = prices.filter(p => !isWeaponKey(p.id));
  const weaponPrices = prices.filter(p =>  isWeaponKey(p.id));

  // For weapons the shop accepts, find the player's owned matching instances.
  const acceptedWeaponKeys = weaponPrices.map(p => p.id);
  const ownedWeapons = acceptedWeaponKeys.length === 0 ? [] : await prisma.characterWeapon.findMany({
    where: { character_id: chars[0].id, weapon_key: { in: acceptedWeaponKeys } },
    orderBy: { created_at: 'asc' },
  });

  const sellableWeapons = ownedWeapons.map(w => {
    const price = weaponPrices.find(p => p.id === w.weapon_key);
    const raw   = loadWeaponYaml(w.weapon_key, __dirname) as Record<string, unknown> | null;
    return {
      id:          w.id,
      weapon_key:  w.weapon_key,
      name:        (raw?.['Name'] as string | undefined) ?? w.weapon_key,
      sell:        price?.sell ?? null,
      bonus_count: weaponBonusCount(w.weapon_key, w.upgrades),
      equipped:    w.id === chars[0].equipped_weapon_id,
    };
  });

  // Weapon listings the shop sells (each buy creates a new instance).
  const weaponListings = weaponPrices.map(p => {
    const raw = loadWeaponYaml(p.id, __dirname) as Record<string, unknown> | null;
    return {
      weapon_key: p.id,
      name:       (raw?.['Name'] as string | undefined) ?? p.id,
      buy:        p.buy  ?? null,
      sell:       p.sell ?? null,
      stock:      p.current_stock,
      stock_max:  p.stock_max,
      infinite:   p.infinite ?? false,
    };
  });

  res.json({
    shopName: config.name,
    npc:      config.npc,
    title:    config.title,
    greeting: config.greeting,
    korel:    dbUser?.korel ?? 0,
    training,
    items: itemPrices.map(p => ({
      id:          p.id,
      name:        ITEMS[p.id]?.name        ?? dbItems.find(i => i.id === p.id)?.name        ?? p.id,
      description: ITEMS[p.id]?.description ?? dbItems.find(i => i.id === p.id)?.description ?? '',
      buy:         p.buy  ?? null,
      sell:        p.sell ?? null,
      stock:       p.current_stock,
      stock_max:   p.stock_max,
      infinite:    p.infinite ?? false,
    })),
    inventory: inventory.map(i => ({
      item_id:     i.item_id,
      name:        i.item.name,
      description: i.item.description,
      quantity:    i.quantity,
    })),
    weapons:          sellableWeapons,
    weapon_listings:  weaponListings,
  });
});

app.post('/api/shop/:shopKey/train', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const shopKey = String(req.params.shopKey);
  const profKey = SHOP_TO_PROFESSION[shopKey];
  if (!profKey) { res.status(400).json({ error: 'No training available here.' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }

  const prof = await prisma.characterProfession.findUnique({
    where: { character_id_profession: { character_id: chars[0].id, profession: profKey } },
  });
  const currentLevel = prof?.level ?? 0;
  if (currentLevel >= PROFESSION_MAX_LEVEL) {
    res.json({ success: false, message: 'Already at max level.' }); return;
  }

  const combined = await getCombinedLevel(chars[0].id);
  const cost     = levelCost(combined);
  if (cost === null) {
    res.json({ success: false, message: 'Combined profession level cap reached.' }); return;
  }
  const dbUser = await prisma.user.findUnique({ where: { discord_id: discordId } });
  if (!dbUser || dbUser.korel < cost) {
    res.json({ success: false, message: `Need ${cost.toLocaleString()} korel (have ${(dbUser?.korel ?? 0).toLocaleString()}).` }); return;
  }

  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { discord_id: discordId }, data: { korel: { decrement: cost } } });
    await tx.characterProfession.upsert({
      where:  { character_id_profession: { character_id: chars[0].id, profession: profKey } },
      update: { level: { increment: 1 } },
      create: { character_id: chars[0].id, profession: profKey, level: 1 },
    });
    await tx.korelLedger.create({ data: {
      discord_id: discordId, amount: -cost,
      reason: 'profession_training',
      note:   `${PROFESSION_NAMES[profKey]} level ${currentLevel + 1}`,
    }});
    await tx.eventLog.create({ data: {
      discord_id: discordId, event_type: 'profession_leveled',
      payload: { profession: profKey, from_level: currentLevel, to_level: currentLevel + 1, cost },
    }}).catch(() => {});
  });

  void syncProgressionRoles(discordId);   // grant any newly-earned progression role

  res.json({
    success:  true,
    message:  `${PROFESSION_NAMES[profKey]} trained to level ${currentLevel + 1}.`,
    newLevel: currentLevel + 1,
    nextCost: currentLevel + 1 < PROFESSION_MAX_LEVEL ? levelCost(combined + 1) : null,
  });
});

app.post('/api/shop/:shopKey/buy', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const shopKey = String(req.params.shopKey);
  if (!validShop(shopKey)) { res.status(404).json({ error: 'Shop not found' }); return; }
  const { itemId, quantity } = req.body as { itemId: string; quantity: number };
  if (!itemId || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
    res.status(400).json({ error: 'Invalid request: quantity must be 1–9999.' }); return;
  }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const config = loadShop(shopKey, SHOP_DIR);
  const prices = await getPrices(shopKey, config);
  const item   = prices.find(p => p.id === itemId);
  if (!item || item.buy == null) { res.status(400).json({ error: 'Item not available' }); return; }
  const buyResult = await buyItem(shopKey, item, chars[0].id, discordId, quantity);
  res.json(buyResult);
  if (buyResult.success) {
    const mention = await playerMention(discordId, chars[0].name);
    void pingChannel(
      (worldConfig.channels as Record<string, string>)[shopKey],
      `${mention} bought **${quantity}× ${ITEMS[itemId]?.name ?? itemId}** from ${config.npc}.`,
    );
  }
});

app.post('/api/shop/:shopKey/sell', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const shopKey = String(req.params.shopKey);
  if (!validShop(shopKey)) { res.status(404).json({ error: 'Shop not found' }); return; }
  const { itemId, quantity } = req.body as { itemId: string; quantity: number };
  if (!itemId || !Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
    res.status(400).json({ error: 'Invalid request: quantity must be 1–9999.' }); return;
  }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const config = loadShop(shopKey, SHOP_DIR);
  const prices = await getPrices(shopKey, config);
  const item   = prices.find(p => p.id === itemId);
  if (!item || item.sell == null) { res.status(400).json({ error: 'Item not available' }); return; }
  const sellResult = await sellItem(shopKey, item, chars[0].id, discordId, quantity);
  res.json(sellResult);
  if (sellResult.success) {
    const mention = await playerMention(discordId, chars[0].name);
    void pingChannel(
      (worldConfig.channels as Record<string, string>)[shopKey],
      `${mention} sold **${quantity}× ${ITEMS[itemId]?.name ?? itemId}** to ${config.npc}.`,
    );
  }
});

app.post('/api/shop/:shopKey/sell-all', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const shopKey = String(req.params.shopKey);
  if (!validShop(shopKey)) { res.status(404).json({ error: 'Shop not found' }); return; }
  const { itemId } = req.body as { itemId: string };
  if (!itemId) { res.status(400).json({ error: 'Invalid request' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const config = loadShop(shopKey, SHOP_DIR);
  const prices = await getPrices(shopKey, config);
  const item   = prices.find(p => p.id === itemId);
  if (!item || item.sell == null) { res.status(400).json({ error: 'Item not available' }); return; }
  const inv = await prisma.inventoryItem.findUnique({
    where: { character_id_item_id: { character_id: chars[0].id, item_id: itemId } },
  });
  if (!inv || inv.quantity === 0) { res.json({ success: false, message: "You don't have any." }); return; }
  const sellAllResult = await sellItem(shopKey, item, chars[0].id, discordId, inv.quantity);
  res.json(sellAllResult);
  if (sellAllResult.success) {
    const mention = await playerMention(discordId, chars[0].name);
    void pingChannel(
      (worldConfig.channels as Record<string, string>)[shopKey],
      `${mention} sold their **${ITEMS[itemId]?.name ?? itemId}** to ${config.npc}.`,
    );
  }
});

// Batch checkout: process a cart of buys+sells in a single transaction.
app.post('/api/shop/:shopKey/checkout', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const shopKey = String(req.params.shopKey);
  if (!validShop(shopKey)) { res.status(404).json({ error: 'Shop not found' }); return; }

  const { buys = [], sells = [], buyWeapons = [], sellWeapons = [] } = req.body as {
    buys?:        Array<{ itemId: string; quantity: number }>,
    sells?:       Array<{ itemId: string; quantity: number }>,
    buyWeapons?:  Array<{ weaponKey: string; quantity: number }>,
    sellWeapons?: string[],
  };

  const validEntry = (e: { itemId?: unknown; quantity?: unknown }) =>
    typeof e.itemId === 'string' && Number.isInteger(e.quantity) && (e.quantity as number) >= 1 && (e.quantity as number) <= 9999;
  const validBuyWeapon = (e: { weaponKey?: unknown; quantity?: unknown }) =>
    typeof e.weaponKey === 'string' && Number.isInteger(e.quantity) && (e.quantity as number) >= 1 && (e.quantity as number) <= 99;
  if (!Array.isArray(buys) || !Array.isArray(sells) || !Array.isArray(sellWeapons) || !Array.isArray(buyWeapons)
      || !buys.every(validEntry) || !sells.every(validEntry)
      || !buyWeapons.every(validBuyWeapon)
      || !sellWeapons.every(id => typeof id === 'string')) {
    res.status(400).json({ error: 'Invalid cart' }); return;
  }
  if (buys.length === 0 && sells.length === 0 && sellWeapons.length === 0 && buyWeapons.length === 0) {
    res.json({ success: false, message: 'Cart is empty.' }); return;
  }

  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const charId        = chars[0].id;
  const equippedId    = chars[0].equipped_weapon_id;

  const config = loadShop(shopKey, SHOP_DIR);
  const prices = await getPrices(shopKey, config);
  const findItem = (id: string) => prices.find(p => p.id === id);

  // Resolve cost / revenue per line.
  let totalCost = 0, totalRevenue = 0;
  const buyLines: Array<{ id: string; name: string; quantity: number; unitPrice: number; infinite: boolean; stockMax: number }> = [];
  const sellLines: Array<{ id: string; name: string; quantity: number; unitPrice: number; stockMax: number }> = [];
  const weaponSellLines: Array<{ id: string; weapon_key: string; name: string; unitPrice: number; bonus_count: number; stockMax: number }> = [];

  for (const b of buys) {
    const item = findItem(b.itemId);
    if (!item || item.buy == null) { res.json({ success: false, message: `${b.itemId} is not for sale.` }); return; }
    // Unlock items: quantity is hard-capped at 1, and if the character
    // already owns one the line silently drops. Players can put 5 in the
    // cart without seeing an error; the cart just resolves to 1 (or 0)
    // for that line at checkout.
    let qty = b.quantity;
    if (isUnlock(b.itemId)) {
      const existing = await prisma.inventoryItem.findUnique({
        where: { character_id_item_id: { character_id: charId, item_id: b.itemId } },
      });
      if (existing && existing.quantity >= 1) continue; // already owned, skip
      qty = 1;
    }
    totalCost += item.buy * qty;
    buyLines.push({ id: b.itemId, name: ITEMS[b.itemId]?.name ?? b.itemId, quantity: qty, unitPrice: item.buy, infinite: item.infinite ?? false, stockMax: item.stock_max });
  }

  // Weapon buys — each unit creates a new CharacterWeapon instance.
  const weaponBuyLines: Array<{ weapon_key: string; name: string; quantity: number; unitPrice: number; infinite: boolean }> = [];
  for (const b of buyWeapons) {
    const item = findItem(b.weaponKey);
    if (!item || item.buy == null) { res.json({ success: false, message: `${b.weaponKey} is not for sale.` }); return; }
    totalCost += item.buy * b.quantity;
    const raw = loadWeaponYaml(b.weaponKey, __dirname) as Record<string, unknown> | null;
    weaponBuyLines.push({
      weapon_key: b.weaponKey,
      name:       (raw?.['Name'] as string | undefined) ?? b.weaponKey,
      quantity:   b.quantity,
      unitPrice:  item.buy,
      infinite:   item.infinite ?? false,
    });
  }
  for (const s of sells) {
    const item = findItem(s.itemId);
    if (!item || item.sell == null) { res.json({ success: false, message: `Shop doesn't buy ${s.itemId}.` }); return; }
    totalRevenue += item.sell * s.quantity;
    sellLines.push({ id: s.itemId, name: ITEMS[s.itemId]?.name ?? s.itemId, quantity: s.quantity, unitPrice: item.sell, stockMax: item.stock_max });
  }

  // Validate each weapon: must be owned, not equipped, and shop must accept its key.
  for (const wid of sellWeapons) {
    const row = await prisma.characterWeapon.findUnique({ where: { id: wid } });
    if (!row || row.character_id !== charId) {
      res.json({ success: false, message: `You don't own one of the weapons in your cart.` }); return;
    }
    if (row.id === equippedId) {
      res.json({ success: false, message: `Unequip a weapon before selling it.` }); return;
    }
    const price = findItem(row.weapon_key);
    if (!price || price.sell == null) {
      res.json({ success: false, message: `Shop doesn't buy ${row.weapon_key}.` }); return;
    }
    const raw = loadWeaponYaml(row.weapon_key, __dirname) as Record<string, unknown> | null;
    totalRevenue += price.sell;
    weaponSellLines.push({
      id: row.id,
      weapon_key: row.weapon_key,
      name: (raw?.['Name'] as string | undefined) ?? row.weapon_key,
      unitPrice: price.sell,
      bonus_count: weaponBonusCount(row.weapon_key, row.upgrades),
      stockMax: price.stock_max,
    });
  }

  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { discord_id: discordId } });
    const currentKorel = user?.korel ?? 0;
    const net = totalRevenue - totalCost;
    if (currentKorel + net < 0) {
      return { success: false, message: `Not enough korel — net ${net}, have ${currentKorel}.` };
    }

    // Apply buys
    for (const b of buyLines) {
      if (!b.infinite) {
        const state = await tx.shopItemState.findUnique({
          where: { shop_id_item_id: { shop_id: shopKey, item_id: b.id } },
        });
        if (!state || state.stock < b.quantity) {
          return { success: false, message: `Only ${state?.stock ?? 0} ${b.name} in stock.` };
        }
      }
      await tx.item.upsert({
        where:  { id: b.id },
        update: {},
        create: { id: b.id, name: b.name, description: ITEMS[b.id]?.description ?? '' },
      });
      await tx.inventoryItem.upsert({
        where:  { character_id_item_id: { character_id: charId, item_id: b.id } },
        update: { quantity: { increment: b.quantity } },
        create: { character_id: charId, item_id: b.id, quantity: b.quantity },
      });
      const stockUpdate = b.infinite
        ? { cumulative_volume: { increment: b.quantity }, recent_volume: { increment: b.quantity } }
        : { stock: { decrement: b.quantity }, cumulative_volume: { increment: b.quantity }, recent_volume: { increment: b.quantity } };
      await tx.shopItemState.update({ where: { shop_id_item_id: { shop_id: shopKey, item_id: b.id } }, data: stockUpdate });
      await tx.shopTransaction.create({
        data: { shop_id: shopKey, item_id: b.id, type: 'buy', quantity: b.quantity, discord_id: discordId },
      });
    }

    // Apply sells (with shop fullness clamping per item)
    const adjustedSells: typeof sellLines = [];
    for (const s of sellLines) {
      const inv = await tx.inventoryItem.findUnique({
        where: { character_id_item_id: { character_id: charId, item_id: s.id } },
      });
      if (!inv || inv.quantity < s.quantity) {
        return { success: false, message: `You only have ${inv?.quantity ?? 0} ${s.name}.` };
      }
      const state = await tx.shopItemState.findUnique({
        where: { shop_id_item_id: { shop_id: shopKey, item_id: s.id } },
      });
      const room  = Math.max(0, s.stockMax - (state?.stock ?? 0));
      const actual = Math.min(s.quantity, room);
      if (actual === 0) {
        return { success: false, message: `${s.name}: shop is fully stocked.` };
      }
      if (inv.quantity === actual) {
        await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: charId, item_id: s.id } } });
      } else {
        await tx.inventoryItem.update({
          where: { character_id_item_id: { character_id: charId, item_id: s.id } },
          data:  { quantity: { decrement: actual } },
        });
      }
      await tx.shopItemState.update({
        where: { shop_id_item_id: { shop_id: shopKey, item_id: s.id } },
        data:  { stock: { increment: actual }, cumulative_volume: { increment: actual }, recent_volume: { increment: actual } },
      });
      await tx.shopTransaction.create({
        data: { shop_id: shopKey, item_id: s.id, type: 'sell', quantity: actual, discord_id: discordId },
      });
      adjustedSells.push({ ...s, quantity: actual });
    }

    // Apply weapon BUYS: each unit creates a new CharacterWeapon row.
    for (const wb of weaponBuyLines) {
      if (!wb.infinite) {
        const state = await tx.shopItemState.findUnique({
          where: { shop_id_item_id: { shop_id: shopKey, item_id: wb.weapon_key } },
        });
        if (!state || state.stock < wb.quantity) {
          return { success: false, message: `Only ${state?.stock ?? 0} ${wb.name} in stock.` };
        }
      }
      for (let i = 0; i < wb.quantity; i++) {
        await tx.characterWeapon.create({
          data: { character_id: charId, weapon_key: wb.weapon_key },
        });
      }
      const stockUpdate = wb.infinite
        ? { cumulative_volume: { increment: wb.quantity }, recent_volume: { increment: wb.quantity } }
        : { stock: { decrement: wb.quantity }, cumulative_volume: { increment: wb.quantity }, recent_volume: { increment: wb.quantity } };
      await tx.shopItemState.update({ where: { shop_id_item_id: { shop_id: shopKey, item_id: wb.weapon_key } }, data: stockUpdate });
      await tx.shopTransaction.create({
        data: { shop_id: shopKey, item_id: wb.weapon_key, type: 'buy', quantity: wb.quantity, discord_id: discordId },
      });
    }

    // Apply weapon sells: re-check ownership/equipped within the txn, enforce
    // the shop's stock cap per weapon_key, and update stock/volumes the same
    // way item-sells do. Without this, shop stock + price model both ignored
    // weapon traffic — see ShopItemState for spellbook stuck at the daily-tick
    // baseline despite 21 sells.
    const soldWeapons: typeof weaponSellLines = [];
    const skippedWeapons: typeof weaponSellLines = [];
    for (const w of weaponSellLines) {
      const row = await tx.characterWeapon.findUnique({ where: { id: w.id } });
      if (!row || row.character_id !== charId) {
        return { success: false, message: `Weapon no longer owned.` };
      }
      if (row.id === equippedId) {
        return { success: false, message: `Unequip ${w.name} before selling.` };
      }
      const state = await tx.shopItemState.findUnique({
        where: { shop_id_item_id: { shop_id: shopKey, item_id: w.weapon_key } },
      });
      if ((state?.stock ?? 0) >= w.stockMax) {
        skippedWeapons.push(w);
        continue;
      }
      await tx.characterWeapon.delete({ where: { id: w.id } });
      await tx.shopItemState.upsert({
        where:  { shop_id_item_id: { shop_id: shopKey, item_id: w.weapon_key } },
        update: { stock: { increment: 1 }, cumulative_volume: { increment: 1 }, recent_volume: { increment: 1 } },
        create: { shop_id: shopKey, item_id: w.weapon_key, x: 0.5, stock: 1, cumulative_volume: 1, recent_volume: 1 },
      });
      await tx.shopTransaction.create({
        data: { shop_id: shopKey, item_id: w.weapon_key, type: 'sell', quantity: 1, discord_id: discordId },
      });
      soldWeapons.push(w);
    }

    // Recompute net using actually-sold lines (item-sells may have clamped to
    // shop room; weapon-sells may have skipped entries for the same reason).
    const actualRevenue = adjustedSells.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
                        + soldWeapons.reduce((sum, l) => sum + l.unitPrice, 0);
    const actualNet = actualRevenue - totalCost;

    // Apply net korel + ledger
    if (actualNet !== 0) {
      const noteParts: string[] = [];
      if (buyLines.length > 0)      noteParts.push(`${buyLines.length} buy`);
      if (adjustedSells.length > 0) noteParts.push(`${adjustedSells.length} sell`);
      if (soldWeapons.length > 0)   noteParts.push(`${soldWeapons.length} weapon`);
      await tx.user.update({
        where: { discord_id: discordId },
        data:  { korel: { increment: actualNet } },
      });
      await tx.korelLedger.create({
        data: {
          discord_id: discordId,
          amount: actualNet,
          reason: 'shop_cart',
          note: `${noteParts.join(', ')} @ ${shopKey}`,
        },
      });
    }

    const skippedNote = skippedWeapons.length > 0
      ? ` (${skippedWeapons.length} weapon${skippedWeapons.length === 1 ? '' : 's'} not taken — shop fully stocked)`
      : '';
    return {
      success: true,
      message: (actualNet >= 0 ? `Checkout complete (+${actualNet} korel)` : `Checkout complete (${actualNet} korel)`) + skippedNote + '.',
      net: actualNet,
      buys: buyLines,
      sells: adjustedSells,
      buyWeapons: weaponBuyLines,
      sellWeapons: soldWeapons,
      skippedWeapons,
    };
  });

  res.json(result);

  if (result.success) {
    const mention = await playerMention(discordId, chars[0].name);
    const ping = formatCartPing(mention, config.npc, (result as unknown as {
      buys: typeof buyLines; sells: typeof sellLines;
      buyWeapons: typeof weaponBuyLines; sellWeapons: typeof weaponSellLines;
    }));
    void pingChannel((worldConfig.channels as Record<string, string>)[shopKey], ping);
  }
});

function formatCartPing(
  mention: string,
  npc: string,
  result: {
    buys:        Array<{ name: string; quantity: number }>;
    sells:       Array<{ name: string; quantity: number }>;
    buyWeapons:  Array<{ name: string; quantity: number }>;
    sellWeapons: Array<{ name: string; bonus_count: number }>;
  },
): string {
  const lines: string[] = [`${mention} at ${npc}'s shop:`];
  for (const b of result.buys)        lines.push(`- bought ${b.quantity}× ${b.name}`);
  for (const w of result.buyWeapons)  lines.push(`- bought ${w.quantity > 1 ? `${w.quantity}× ` : ''}${w.name}`);
  for (const s of result.sells)       lines.push(`- sold ${s.quantity}× ${s.name}`);
  for (const w of result.sellWeapons) lines.push(`- sold ${w.name}${w.bonus_count > 0 ? ` +${w.bonus_count}` : ''}`);
  return lines.join('\n');
}

// Helper to apply transaction shock — duplicated from shop_service.ts since we already imported the others
async function applyTransactionShockHelper(_shopKey: string, _item: { id: string }, _qty: number, _isBuy: boolean): Promise<void> {
  // Shock is computed inside shop_service.applyTransactionShock — but that's not exported.
  // For now skip; price drift can be handled by next maybeTickDaily. TODO: export applyTransactionShock.
}

// ---- Craft routes ----

app.get('/craft', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../../public/craft.html'));
});

app.get('/api/craft', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }

  const [dbUser, profRows] = await Promise.all([
    prisma.user.findUnique({ where: { discord_id: discordId } }),
    prisma.characterProfession.findMany({ where: { character_id: chars[0].id } }),
  ]);
  const profLevels: Record<string, number> = {};
  for (const p of profRows) profLevels[p.profession] = p.level;
  const combined = profRows.reduce((sum, p) => sum + p.level, 0);

  const [inventory, ownedWeapons] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { character_id: chars[0].id } }),
    prisma.characterWeapon.findMany({ where: { character_id: chars[0].id }, select: { id: true, weapon_key: true } }),
  ]);
  const invMap: Record<string, number> = {};
  for (const inv of inventory) invMap[inv.item_id] = inv.quantity;

  const equippedId = chars[0].equipped_weapon_id;
  const unEquippedKeyCounts: Record<string, number> = {};
  for (const w of ownedWeapons) {
    if (w.id === equippedId) continue;
    unEquippedKeyCounts[w.weapon_key] = (unEquippedKeyCounts[w.weapon_key] ?? 0) + 1;
  }

  const ingredientMet = (i: { item_id?: string; weapon_id?: string; quantity: number }): boolean => {
    if (i.weapon_id) return (unEquippedKeyCounts[i.weapon_id] ?? 0) >= 1;
    return (invMap[i.item_id ?? ''] ?? 0) >= i.quantity;
  };

  const allRecipes = loadAllRecipes(RECIPES_DIR);
  const recipes = allRecipes.map(r => ({
    ...r,
    levelMet:       (profLevels[r.profession] ?? 0) >= r.required_level,
    ingredientsMet: r.ingredients.every(ingredientMet),
    available:      (profLevels[r.profession] ?? 0) >= r.required_level && r.ingredients.every(ingredientMet),
    ingredients: r.ingredients.map(i => {
      if (i.item_id) return { ...i, name: ITEMS[i.item_id]?.name ?? i.item_id };
      if (i.weapon_id) {
        const raw = loadWeaponYaml(i.weapon_id, __dirname) as Record<string, unknown> | null;
        return { ...i, name: (raw?.['Name'] as string | undefined) ?? i.weapon_id };
      }
      return { ...i, name: '' };
    }),
  }));

  res.json({
    characterName: chars[0].name,
    professions: Object.fromEntries(
      PROFESSIONS.map(p => [p, {
        label:    PROFESSION_NAMES[p],
        level:    profLevels[p] ?? 0,
        maxLevel: PROFESSION_MAX_LEVEL,
        nextCost: (profLevels[p] ?? 0) < PROFESSION_MAX_LEVEL ? levelCost(combined) : null,
      }])
    ),
    recipes,
    inventory: invMap,
    korel: dbUser?.korel ?? 0,
  });
});

app.post('/api/craft/:recipeId', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }

  const allRecipes = loadAllRecipes(RECIPES_DIR);
  const recipe = allRecipes.find(r => r.id === String(req.params.recipeId));
  if (!recipe) { res.status(404).json({ error: 'Recipe not found' }); return; }

  const prof = await prisma.characterProfession.findUnique({
    where: { character_id_profession: { character_id: chars[0].id, profession: recipe.profession } },
  });
  if ((prof?.level ?? 0) < recipe.required_level) {
    res.json({ success: false, message: `Requires ${PROFESSION_NAMES[recipe.profession as ProfessionKey] ?? recipe.profession} level ${recipe.required_level}.` }); return;
  }

  const qty = Math.max(1, Math.min(99, Math.floor(Number((req.body as { quantity?: unknown }).quantity) || 1)));

  const result = await prisma.$transaction(async tx => {
    for (const ing of recipe.ingredients) {
      if (ing.weapon_id) {
        // Find oldest unequipped instance of this weapon_key to consume.
        const wep = await tx.characterWeapon.findFirst({
          where: {
            character_id: chars[0].id,
            weapon_key:   ing.weapon_id,
            NOT: chars[0].equipped_weapon_id ? { id: chars[0].equipped_weapon_id } : undefined,
          },
          orderBy: { created_at: 'asc' },
        });
        if (!wep) return { success: false, message: `Requires an unequipped ${ing.weapon_id}.` };
        await tx.characterWeapon.delete({ where: { id: wep.id } });
      } else if (ing.item_id) {
        const needed = ing.quantity * qty;
        const inv = await tx.inventoryItem.findUnique({
          where: { character_id_item_id: { character_id: chars[0].id, item_id: ing.item_id } },
        });
        if (!inv || inv.quantity < needed) {
          return { success: false, message: `Not enough ${ing.item_id} — need ${needed}, have ${inv?.quantity ?? 0}.` };
        }
        if (inv.quantity === needed) {
          await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: chars[0].id, item_id: ing.item_id } } });
        } else {
          await tx.inventoryItem.update({
            where: { character_id_item_id: { character_id: chars[0].id, item_id: ing.item_id } },
            data:  { quantity: { decrement: needed } },
          });
        }
      }
    }

    const outputId  = recipe.output.id!;
    const outQty    = (recipe.output.quantity ?? 1) * qty;
    if (recipe.output.type === 'item') {
      await tx.item.upsert({
        where:  { id: outputId },
        update: {},
        create: { id: outputId, name: ITEMS[outputId]?.name ?? outputId, description: ITEMS[outputId]?.description ?? '' },
      });
      await tx.inventoryItem.upsert({
        where:  { character_id_item_id: { character_id: chars[0].id, item_id: outputId } },
        update: { quantity: { increment: outQty } },
        create: { character_id: chars[0].id, item_id: outputId, quantity: outQty },
      });
    } else {
      // Always create a new weapon instance — weapons are unique.
      const rawWeapon   = recipe.output.base_bonus ? loadWeaponYaml(outputId, __dirname) : null;
      const baseUpgrades = rawWeapon && recipe.output.base_bonus
        ? computeBaseUpgrades(rawWeapon, recipe.output.base_bonus)
        : {};
      const hasBase = Object.keys(baseUpgrades).length > 0;

      for (let i = 0; i < qty; i++) {
        await tx.characterWeapon.create({
          data: {
            character_id: chars[0].id,
            weapon_key:   outputId,
            ...(hasBase ? { upgrades: { base: baseUpgrades } as Prisma.InputJsonValue } : {}),
          },
        });
      }
    }

    await tx.eventLog.create({ data: {
      discord_id: discordId, event_type: 'item_crafted',
      payload: { recipe_id: recipe.id, output: recipe.output as unknown as object },
    }}).catch(() => {});

    return { success: true, message: qty > 1 ? `Crafted ${qty}× ${recipe.name}.` : `Crafted ${recipe.name}.` };
  });

  res.json(result);
  if (result.success) {
    const mention = await playerMention(discordId, chars[0].name);
    const pingMsg = qty > 1
      ? `${mention} crafted **${qty}× ${recipe.name}**!`
      : `${mention} crafted a **${recipe.name}**!`;
    void pingChannel(PROFESSION_CHANNEL[recipe.profession], pingMsg);
  }
});

// ---- Upgrade endpoints ----

function loadWeaponYaml(weaponKey: string, dirname: string): RawWeapon | null {
  const p = join(dirname, `../../database/weapons/${weaponKey}.yaml`);
  if (!fs.existsSync(p)) return null;
  return yaml.load(fs.readFileSync(p, 'utf-8')) as RawWeapon;
}

function computeBaseUpgrades(
  raw: RawWeapon,
  base_bonus: NonNullable<RecipeOutput['base_bonus']>,
): Record<string, number | number[]> {
  const result: Record<string, number | number[]> = {};
  const catMap: Record<string, RawAction[]> = {
    defend:  raw.Defend  ?? [],
    attack:  raw.Attack  ?? [],
    special: raw.Special ?? [],
  };
  for (const cat of Object.keys(base_bonus) as ('defend' | 'attack' | 'special')[]) {
    for (const action of catMap[cat]) {
      const kind = upgradeKind(action);
      if (kind === 'field') {
        result[action.Name] = new Array(action.Field!.length).fill(1);
        break;
      } else if (kind === 'value') {
        result[action.Name] = 1;
        break;
      }
    }
  }
  return result;
}

app.get('/api/upgrade', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const profRows    = await prisma.characterProfession.findMany({ where: { character_id: char.id } });
  const profLevelOf = (p: string) => profRows.find(r => r.profession === p)?.level ?? 0;

  const weaponRows = await prisma.characterWeapon.findMany({
    where: { character_id: char.id },
    orderBy: { created_at: 'asc' },
  });

  const CAT_LABELS: Record<string, string> = {
    defend: 'Defend', defend_crit: 'Defend Crit',
    attack: 'Attack', attack_crit: 'Attack Crit',
    special: 'Special', special_crit: 'Special Crit',
  };

  const weapons = [];
  for (const row of weaponRows) {
    const raw = loadWeaponYaml(row.weapon_key, __dirname);
    if (!raw) continue;

    const professions  = weaponUpgradeProfessions(row.weapon_key);
    const profession   = professions[0];
    const upgrades     = (row.upgrades ?? {}) as { base?: Record<string, unknown>; player?: unknown; upgradesDone?: number; hpBonus?: number };
    const baseDeltas   = (upgrades.base ?? {}) as Record<string, number | number[]>;
    const playerUpgrades = normalizePlayerUpgrades(upgrades.player, profession);

    const baseLevel    = (raw as { Level?: number }).Level ?? 1;
    const weaponObj    = Weapon.from_file(join(__dirname, `../../database/weapons/${row.weapon_key}.yaml`));
    const ratio        = hpBudgetRatio(weaponObj, baseLevel);
    const upgradesDone = upgrades.upgradesDone ?? 0;
    const hpBonus      = upgrades.hpBonus ?? 0;
    const cap          = profession ? Math.min(budgetForLevel(profLevelOf(profession)), maxUpgrades(baseLevel)) : 0;
    const next         = (profession && upgradesDone < cap) ? upgradeSplit(upgradesDone + 1, baseLevel, ratio) : null;
    const nextCost     = next && profession ? upgradeCost(upgradesDone + 1, profession, baseLevel) : null;

    const actions = actionsWithCategories(raw).map(({ category, action: a }) => {
      const kind = upgradeKind(a);
      if (!kind) {
        return { name: a.Name, category, label: CAT_LABELS[category], upgradeable: false };
      }
      if (kind === 'field') {
        const base      = a.Field!;
        const baseB     = (baseDeltas[a.Name] as number[] | undefined) ?? base.map(() => 0);
        const playerB   = summedFieldBonus(playerUpgrades, professions, a.Name, base.length);
        const effective = base.map((v, i) => v + (baseB[i] ?? 0) + playerB[i]);
        return { name: a.Name, category, label: CAT_LABELS[category], upgradeable: true, type: 'field', base, base_bonus: baseB, player_bonus: playerB, effective, field_len: base.length };
      }
      const base    = a.Value!;
      const baseB   = (baseDeltas[a.Name] as number | undefined) ?? 0;
      const playerB = summedValueBonus(playerUpgrades, professions, a.Name);
      return { name: a.Name, category, label: CAT_LABELS[category], upgradeable: true, type: 'value', base, base_bonus: baseB, player_bonus: playerB, effective: base + baseB + playerB };
    });

    weapons.push({
      id: row.id,
      weapon_key: row.weapon_key,
      name: raw.Name,
      equipped: row.id === char.equipped_weapon_id,
      bonus_count: weaponBonusCount(row.weapon_key, row.upgrades),
      profession: profession ?? null,
      base_level: baseLevel,
      upgrades_done: upgradesDone,
      upgrade_cap: cap,
      hp_bonus: hpBonus,
      base_hp: weaponObj.hp,
      next_upgrade: next,   // { value, hp, ev } | null
      next_cost: nextCost ? { ...nextCost, material_name: ITEMS[nextCost.material]?.name ?? nextCost.material } : null,
      actions,
    });
  }

  res.json({ characterName: char.name, lj_level: profLevelOf('lumberjack'), weapons });
});

app.post('/api/upgrade/:weaponId', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const weaponId = String(req.params['weaponId']);
  // One atomic upgrade: distribute its EV pool across one or more actions
  // ({ actionName: delta }). The HP portion auto-applies on commit.
  const { distribution } = req.body as { distribution: Record<string, number | number[]> };
  if (!distribution || typeof distribution !== 'object') {
    res.json({ success: false, message: 'Expected a distribution.' }); return;
  }

  const weaponRowEarly = await prisma.characterWeapon.findUnique({ where: { id: weaponId } });
  if (!weaponRowEarly || weaponRowEarly.character_id !== char.id) {
    res.status(404).json({ error: 'Weapon not found' });
    return;
  }
  const weaponKey = weaponRowEarly.weapon_key;
  const raw = loadWeaponYaml(weaponKey, __dirname);
  if (!raw) { res.status(404).json({ error: 'Weapon not found' }); return; }

  const profession = weaponUpgradeProfessions(weaponKey)[0];
  if (!profession) { res.json({ success: false, message: 'This weapon cannot be upgraded.' }); return; }

  const baseLevel = (raw as { Level?: number }).Level ?? 1;
  const weaponObj = Weapon.from_file(join(__dirname, `../../database/weapons/${weaponKey}.yaml`));
  const ratio     = hpBudgetRatio(weaponObj, baseLevel);
  const rawByName = new Map(allRawActions(raw).map(a => [a.Name, a]));

  const result = await prisma.$transaction(async tx => {
    const weaponRow = await tx.characterWeapon.findUnique({ where: { id: weaponId } });
    if (!weaponRow || weaponRow.character_id !== char.id) {
      return { success: false, message: 'You do not own this weapon.' };
    }
    const profRow   = await tx.characterProfession.findFirst({ where: { character_id: char.id, profession } });
    const cap       = Math.min(budgetForLevel(profRow?.level ?? 0), maxUpgrades(baseLevel));

    const upgrades     = (weaponRow.upgrades ?? {}) as { base?: Record<string, unknown>; player?: unknown; enchants?: Record<string, unknown>; upgradesDone?: number; hpBonus?: number };
    const upgradesDone = upgrades.upgradesDone ?? 0;
    if (upgradesDone >= cap) {
      return { success: false, message: `No upgrade available — level up ${profession} to unlock more (${upgradesDone}/${cap}).` };
    }
    const split = upgradeSplit(upgradesDone + 1, baseLevel, ratio);  // { value, hp, ev }

    // Validate the distribution. A point = +1 EV: for a field action the field
    // sum rises by `field_length` per point (so the average/EV rises by 1), so
    // its EV cost = sum(delta)/length; a value action costs its delta directly.
    // The total EV spent must equal the upgrade's pool exactly.
    let totalEv = 0;
    for (const [name, delta] of Object.entries(distribution)) {
      const a = rawByName.get(name);
      if (!a) return { success: false, message: `Unknown action: ${name}.` };
      const kind = upgradeKind(a);
      if (!kind) return { success: false, message: `${name} cannot be upgraded.` };
      if (kind === 'field') {
        const len = a.Field!.length;
        if (!Array.isArray(delta) || delta.length !== len || !delta.every(v => Number.isInteger(v) && v >= 0)) {
          return { success: false, message: `Bad delta for ${name}.` };
        }
        const sum = delta.reduce((s, v) => s + v, 0);
        if (sum % len !== 0) return { success: false, message: `${name}: spread points to a whole +EV (a multiple of ${len}).` };
        totalEv += sum / len;
      } else {
        if (typeof delta !== 'number' || !Number.isInteger(delta) || delta < 0) {
          return { success: false, message: `Bad delta for ${name}.` };
        }
        totalEv += delta;
      }
    }
    if (totalEv !== split.ev) {
      return { success: false, message: `Spend exactly ${split.ev} points (you spent ${totalEv}).` };
    }

    // Material cost (placeholder — to be tuned via the economy sim).
    const cost   = upgradeCost(upgradesDone + 1, profession, baseLevel);
    const invRow = await tx.inventoryItem.findUnique({ where: { character_id_item_id: { character_id: char.id, item_id: cost.material } } });
    if ((invRow?.quantity ?? 0) < cost.quantity) {
      return { success: false, message: `Need ${cost.quantity} ${ITEMS[cost.material]?.name ?? cost.material} (have ${invRow?.quantity ?? 0}).` };
    }
    if (invRow!.quantity === cost.quantity) {
      await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: char.id, item_id: cost.material } } });
    } else {
      await tx.inventoryItem.update({ where: { character_id_item_id: { character_id: char.id, item_id: cost.material } }, data: { quantity: { decrement: cost.quantity } } });
    }

    // Apply: fold each delta into the stored per-action deltas, bank the HP, bump the count.
    const playerUpgrades = normalizePlayerUpgrades(upgrades.player, profession);
    const profDeltas: Record<string, number | number[]> = { ...(playerUpgrades[profession] ?? {}) };
    for (const [name, delta] of Object.entries(distribution)) {
      const a = rawByName.get(name)!;
      if (upgradeKind(a) === 'field') {
        const existing = (profDeltas[name] as number[] | undefined) ?? a.Field!.map(() => 0);
        profDeltas[name] = existing.map((v, i) => v + (delta as number[])[i]);
      } else {
        profDeltas[name] = ((profDeltas[name] as number | undefined) ?? 0) + (delta as number);
      }
    }
    const updatedPlayer = { ...playerUpgrades, [profession]: profDeltas };
    await tx.characterWeapon.update({
      where: { id: weaponId },
      data: { upgrades: { ...upgrades, base: upgrades.base ?? {}, player: updatedPlayer, upgradesDone: upgradesDone + 1, hpBonus: (upgrades.hpBonus ?? 0) + split.hp } as Prisma.InputJsonValue },
    });

    await tx.eventLog.create({ data: {
      discord_id: discordId, event_type: 'weapon_upgraded',
      payload: { weapon_id: weaponId, weapon_key: weaponKey, profession, upgrade: upgradesDone + 1 } as unknown as Prisma.InputJsonValue,
    }}).catch(() => {});

    return { success: true, message: `Upgrade ${upgradesDone + 1} applied: +${split.hp} HP, +${split.ev} EV.` };
  });

  res.json(result);
  if (result.success) {
    const mention = await playerMention(discordId, chars[0].name);
    void pingChannel(PROFESSION_CHANNEL[profession], `${mention} upgraded **${raw.Name}**!`);
  }
});

// ---- Enchant endpoint ----

app.get('/api/enchant', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const encProfRow = await prisma.characterProfession.findUnique({
    where: { character_id_profession: { character_id: char.id, profession: 'enchanter' } },
  });
  const encLvl = encProfRow?.level ?? 0;

  const weaponRows = await prisma.characterWeapon.findMany({
    where: { character_id: char.id },
    orderBy: { created_at: 'asc' },
  });

  const CAT_LABELS: Record<string, string> = {
    defend: 'Defend', defend_crit: 'Defend Crit',
    attack: 'Attack', attack_crit: 'Attack Crit',
    special: 'Special', special_crit: 'Special Crit',
  };

  const weapons = weaponRows.map(row => {
    const raw = loadWeaponYaml(row.weapon_key, __dirname);
    if (!raw) return null;
    const level = (raw.Level ?? 1) as number;
    const upgrades = (row.upgrades ?? {}) as { base?: Record<string, unknown>; player?: unknown; enchants?: WeaponEnchants };
    const enchants = upgrades.enchants ?? {};
    const baseDeltas      = (upgrades.base ?? {}) as Record<string, number | number[]>;
    const professions     = weaponUpgradeProfessions(row.weapon_key);
    const playerUpgrades  = normalizePlayerUpgrades(upgrades.player, professions[0]);

    const actions = actionsWithCategories(raw).map(({ category, action: a }) => {
      const kind = upgradeKind(a);
      const ar = a as unknown as Record<string, unknown>;
      let effective: number | number[] = 0;
      if (kind === 'field') {
        const base    = a.Field!;
        const baseB   = (baseDeltas[a.Name] as number[] | undefined) ?? base.map(() => 0);
        const playerB = summedFieldBonus(playerUpgrades, professions, a.Name, base.length);
        effective = base.map((v, i) => v + (baseB[i] ?? 0) + playerB[i]);
      } else if (kind === 'value') {
        const base    = a.Value!;
        const baseB   = (baseDeltas[a.Name] as number | undefined) ?? 0;
        const playerB = summedValueBonus(playerUpgrades, professions, a.Name);
        effective = base + baseB + playerB;
      }
      return {
        name: a.Name, category, label: CAT_LABELS[category],
        upgradeable: !!kind,
        field_len: kind === 'field' ? (a.Field?.length ?? 0) : 0,
        type: kind,
        effective,
        damage_type:    (ar['Damage_Type']    ?? '') as string,
        damage_subtype: (ar['Damage_Subtype'] ?? '') as string,
        enchanted: !!enchants[enchantSlotKey('upgrade', a.Name)],
      };
    });

    return {
      id: row.id,
      weapon_key: row.weapon_key,
      name: raw.Name,
      level,
      equipped: row.id === char.equipped_weapon_id,
      bonus_count: weaponBonusCount(row.weapon_key, row.upgrades),
      enchant_slots: ENCHANT_SLOTS,
      enchants_used: enchantSlotsUsed(enchants),
      enchants,
      rank_required: enchantRankRequired(level),
      health_hp:  enchantHealthHp(level),
      upgrade_ev: upgradeEnchantEv(level),
      melee:  { ...SIDAEV_DEF.melee,  field: sidaevField('melee',  level) },
      ranged: { ...SIDAEV_DEF.ranged, field: sidaevField('ranged', level) },
      cost: enchantCost(level),
      actions,
    };
  }).filter(Boolean);

  const inv = await prisma.inventoryItem.findMany({
    where: { character_id: char.id, item_id: { in: ['thuvel', 'hiruos', 'nodol'] } },
  });
  const materials: Record<string, number> = { thuvel: 0, hiruos: 0, nodol: 0 };
  for (const i of inv) materials[i.item_id] = i.quantity;

  res.json({
    characterName: char.name,
    enchanter_level: encLvl,
    materials,
    enchant_slots: ENCHANT_SLOTS,
    damage_types: DAMAGE_TYPES,
    damage_subtypes: DAMAGE_SUBTYPES,
    weapons,
  });
});

app.post('/api/enchant/:weaponId', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const weaponId = String(req.params['weaponId']);
  const weaponRowEarly = await prisma.characterWeapon.findUnique({ where: { id: weaponId } });
  if (!weaponRowEarly || weaponRowEarly.character_id !== char.id) {
    res.status(404).json({ error: 'Weapon not found' });
    return;
  }
  const weaponKey = weaponRowEarly.weapon_key;
  const { type, action: actionName, delta, damage_type, damage_subtype } = req.body as {
    type: string; action?: string; delta?: number | number[]; damage_type?: string; damage_subtype?: string;
  };

  const ENCHANT_TYPES = ['health', 'melee', 'ranged', 'upgrade'];
  if (!ENCHANT_TYPES.includes(type)) { res.status(400).json({ error: 'type must be one of: ' + ENCHANT_TYPES.join(', ') }); return; }
  const enchType = type as EnchantType;

  const raw = loadWeaponYaml(weaponKey, __dirname);
  if (!raw) { res.status(404).json({ error: 'Weapon not found' }); return; }
  const level = (raw.Level ?? 1) as number;

  // Validate the upgrade-enchant payload (EV distribution + optional retype).
  let storedDelta: number | number[] | undefined;
  let storedDT: string | undefined;
  let storedDST: string | undefined;
  if (enchType === 'upgrade') {
    if (!actionName) { res.json({ success: false, message: 'Pick an ability to enchant.' }); return; }
    const action = allRawActions(raw).find(a => a.Name === actionName);
    if (!action) { res.json({ success: false, message: 'Action not found on this weapon.' }); return; }
    const uk = upgradeKind(action);
    if (!uk) { res.json({ success: false, message: 'This ability cannot be enchanted.' }); return; }
    const ev = upgradeEnchantEv(level);
    if (uk === 'field') {
      const fieldLen = action.Field?.length ?? 0;
      if (!Array.isArray(delta) || delta.length !== fieldLen) {
        res.json({ success: false, message: 'Delta must be an array matching the ability field length.' }); return;
      }
      if ((delta as number[]).reduce((a, b) => a + b, 0) !== ev * fieldLen) {
        res.json({ success: false, message: `Distribute exactly ${ev} EV (field entries must sum to ${ev * fieldLen}).` }); return;
      }
      storedDelta = delta;
    } else {
      if (delta !== ev) { res.json({ success: false, message: `Delta must be ${ev} for this ability.` }); return; }
      storedDelta = delta;
    }
    if (damage_type || damage_subtype) {
      if (damage_type && !(DAMAGE_TYPES as readonly string[]).includes(damage_type)) { res.json({ success: false, message: 'Invalid damage type.' }); return; }
      if (damage_subtype && !(DAMAGE_SUBTYPES as readonly string[]).includes(damage_subtype)) { res.json({ success: false, message: 'Invalid damage subtype.' }); return; }
      storedDT  = damage_type  || undefined;
      storedDST = damage_subtype || undefined;
    }
  }

  // Enchanter rank gate — 2× the weapon level (all types unlock together).
  const encProfRow = await prisma.characterProfession.findUnique({
    where: { character_id_profession: { character_id: char.id, profession: 'enchanter' } },
  });
  const encLvl = encProfRow?.level ?? 0;
  const requiredRank = enchantRankRequired(level);
  if (encLvl < requiredRank) {
    res.json({ success: false, message: `Requires Enchanter rank ${requiredRank} to enchant a level ${level} weapon.` }); return;
  }

  const cost = enchantCost(level);
  const ENCH_LABEL: Record<EnchantType, string> = { health: 'Health', melee: 'Sidaev Strike', ranged: 'Sidaev Pulse', upgrade: 'Upgrade' };

  const result = await prisma.$transaction(async tx => {
    for (const [mat, qty] of Object.entries(cost)) {
      const inv = await tx.inventoryItem.findUnique({
        where: { character_id_item_id: { character_id: char.id, item_id: mat } },
      });
      if (!inv || inv.quantity < qty) {
        return { success: false, message: `Not enough ${mat} — need ${qty}.` };
      }
      if (inv.quantity === qty) {
        await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: char.id, item_id: mat } } });
      } else {
        await tx.inventoryItem.update({
          where: { character_id_item_id: { character_id: char.id, item_id: mat } },
          data:  { quantity: { decrement: qty } },
        });
      }
    }

    const weaponRow = await tx.characterWeapon.findUnique({ where: { id: weaponId } });
    if (!weaponRow || weaponRow.character_id !== char.id) {
      return { success: false, message: 'You do not own this weapon.' };
    }

    const upgrades = (weaponRow.upgrades ?? {}) as {
      base?: Record<string, unknown>;
      player?: Record<string, unknown>;
      enchants?: WeaponEnchants;
    };
    const enchants: WeaponEnchants = upgrades.enchants ?? {};

    const check = canAddEnchant(enchants, enchType, actionName);
    if (!check.ok) return { success: false, message: check.reason };

    const slotKey = enchantSlotKey(enchType, actionName);
    const newEnchant: WeaponEnchant = {
      type: enchType,
      ...(enchType === 'upgrade' ? {
        action: actionName,
        delta: storedDelta,
        ...(storedDT  ? { damage_type:    storedDT  } : {}),
        ...(storedDST ? { damage_subtype: storedDST } : {}),
      } : {}),
    };

    await tx.characterWeapon.update({
      where: { id: weaponId },
      data: {
        upgrades: {
          ...upgrades,
          enchants: { ...enchants, [slotKey]: newEnchant },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.eventLog.create({ data: {
      discord_id: discordId,
      event_type: 'weapon_enchanted',
      payload: { weapon_id: weaponId, weapon_key: weaponKey, enchant_type: enchType, action: actionName ?? null },
    }}).catch(() => {});

    const label = enchType === 'upgrade' ? `${ENCH_LABEL.upgrade} on ${actionName}` : ENCH_LABEL[enchType];
    return { success: true, message: `${raw.Name} enchanted — ${label}.` };
  });

  res.json(result);
  if (result.success) {
    const mention = await playerMention(discordId, chars[0].name);
    const label = enchType === 'upgrade' ? `Upgrade on ${actionName}` : ENCH_LABEL[enchType];
    void pingChannel(
      PROFESSION_CHANNEL.enchanter,
      `${mention} enchanted **${raw.Name}** — ${label}!`,
    );
  }
});

sessions.set('test', createSession('test', 'lithkem_swallow').session);

// ---- Orchard (Lumberjack profession layer) ----
// Plots multiply a planted item on a 4h tick (capped 24h). Rolls are advanced +
// persisted lazily on read/harvest (a plot only ticks when its owner looks at it,
// which they must do to harvest — same outcome as a background clock, no global
// writer). See docs/orchard.md + orchard_service.ts.

// The orchard uses BUY price (wider spread; see docs/orchard.md).
const orchardBasePrice = (itemId: string): number | undefined => baseBuyPrices(SHOP_DIR).get(itemId);

type OrchardRow = { character_id: string; slot: number; item_id: string | null; seed_count: number; fertilizer: number; accrued: number; ticks_banked: number; last_tick_at: Date };

const orchardSlotView = (slot: number, row: OrchardRow | undefined) => {
  const fertilizer = row?.fertilizer ?? 0;
  if (!row || !row.item_id) return { slot, empty: true, fertilizer };
  const price = orchardBasePrice(row.item_id);
  return {
    slot, empty: false, fertilizer,
    item_id: row.item_id, name: ITEMS[row.item_id]?.name ?? row.item_id,
    seed_count: row.seed_count, accrued: row.accrued,
    ticks_banked: row.ticks_banked, ticks_until_cap: ticksUntilCap(row),
    odds: effectiveChance(price, fertilizer),
    multiplier: expectedMultiplier(price, fertilizer),
    next_roll_at: nextRollAt(row)?.toISOString() ?? null,
  };
};

async function lumberjackLevel(characterId: string): Promise<number> {
  const row = await prisma.characterProfession.findUnique({
    where: { character_id_profession: { character_id: characterId, profession: 'lumberjack' } },
  }).catch(() => null);
  return row?.level ?? 0;
}

app.get('/api/orchard', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const ljLevel = await lumberjackLevel(char.id);
  const { plots, capacity } = orchardCapacity(ljLevel);
  const rows = await prisma.orchardPlot.findMany({ where: { character_id: char.id } });
  const bySlot = new Map<number, OrchardRow>(rows.map(r => [r.slot, r as OrchardRow]));
  const now = new Date();

  const slots = [];
  let fertUsed = 0;
  for (let slot = 0; slot < plots; slot++) {
    let row = bySlot.get(slot);
    if (row && row.item_id) {
      const adv = advancePlot(row as PlotState, orchardBasePrice(row.item_id), now);
      if (adv.changed) {
        await prisma.orchardPlot.update({
          where: { character_id_slot: { character_id: char.id, slot } },
          data: { accrued: adv.accrued, ticks_banked: adv.ticks_banked, last_tick_at: adv.last_tick_at },
        }).catch(() => {});
        row = { ...row, accrued: adv.accrued, ticks_banked: adv.ticks_banked, last_tick_at: adv.last_tick_at };
      }
    }
    fertUsed += row?.fertilizer ?? 0;
    slots.push(orchardSlotView(slot, row));
  }

  // Plantable inventory: owned, has a buy price, not an unlock permit. Odds shown
  // at the 1-fertilizer baseline (the page re-derives per plot once fertilized).
  const prices = baseBuyPrices(SHOP_DIR);
  const inv = await prisma.inventoryItem.findMany({ where: { character_id: char.id } });
  const plantable = inv
    .filter(i => i.quantity > 0 && ITEMS[i.item_id]?.type !== 'unlock' && prices.has(i.item_id))
    .map(i => ({
      item_id: i.item_id, name: ITEMS[i.item_id]?.name ?? i.item_id, owned: i.quantity,
      odds: effectiveChance(prices.get(i.item_id), 1), multiplier: expectedMultiplier(prices.get(i.item_id), 1),
    }))
    .sort((a, b) => b.multiplier - a.multiplier);

  res.json({
    lj_level: ljLevel, plots, capacity,
    fertilizer_pool: fertilizerPool(ljLevel), fertilizer_free: Math.max(0, fertilizerPool(ljLevel) - fertUsed),
    roll_ms: ORCHARD_TICK_MS, cap_rolls: 6,
    slots, plantable,
  });
});

app.post('/api/orchard/plant', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const body = req.body as { slot?: number; item_id?: string; quantity?: number };
  const slot = Math.trunc(Number(body.slot));
  const itemId = String(body.item_id ?? '');
  const quantity = Math.trunc(Number(body.quantity));

  const { plots, capacity } = orchardCapacity(await lumberjackLevel(char.id));
  if (!(slot >= 0 && slot < plots)) { res.json({ success: false, message: 'That plot is locked.' }); return; }
  if (!(quantity >= 1)) { res.json({ success: false, message: 'Plant at least one.' }); return; }
  if (quantity > capacity) { res.json({ success: false, message: `That plot holds up to ${capacity}.` }); return; }
  if (ITEMS[itemId]?.type === 'unlock' || !orchardBasePrice(itemId)) { res.json({ success: false, message: "You can't plant that." }); return; }

  const result = await prisma.$transaction(async tx => {
    const existing = await tx.orchardPlot.findUnique({ where: { character_id_slot: { character_id: char.id, slot } } });
    if (existing?.item_id) return { success: false, message: 'Harvest or clear that plot first.' };
    const inv = await tx.inventoryItem.findUnique({ where: { character_id_item_id: { character_id: char.id, item_id: itemId } } });
    if (!inv || inv.quantity < quantity) return { success: false, message: `You only have ${inv?.quantity ?? 0}.` };
    if (inv.quantity === quantity) await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: char.id, item_id: itemId } } });
    else await tx.inventoryItem.update({ where: { character_id_item_id: { character_id: char.id, item_id: itemId } }, data: { quantity: { decrement: quantity } } });
    await tx.orchardPlot.upsert({
      where: { character_id_slot: { character_id: char.id, slot } },
      update: { item_id: itemId, seed_count: quantity, accrued: 0, ticks_banked: 0, last_tick_at: new Date() },
      create: { character_id: char.id, slot, item_id: itemId, seed_count: quantity, accrued: 0, ticks_banked: 0, last_tick_at: new Date() },
    });
    return { success: true, message: `Planted ${quantity} ${ITEMS[itemId]?.name ?? itemId}.` };
  });
  res.json(result);
});

// Harvest a plot. `replant: true` re-seeds the same item from inventory afterward.
async function orchardHarvest(characterId: string, slot: number, replant: boolean) {
  return prisma.$transaction(async tx => {
    const row = await tx.orchardPlot.findUnique({ where: { character_id_slot: { character_id: characterId, slot } } });
    if (!row || !row.item_id) return { success: false, message: 'Nothing growing there.' };
    const itemId = row.item_id;
    const adv = advancePlot(row as PlotState, orchardBasePrice(itemId), new Date());
    const harvested = adv.accrued;

    if (harvested > 0) {
      await tx.inventoryItem.upsert({
        where: { character_id_item_id: { character_id: characterId, item_id: itemId } },
        update: { quantity: { increment: harvested } },
        create: { character_id: characterId, item_id: itemId, quantity: harvested },
      });
    }

    let replanted = false;
    if (replant) {
      const seed = row.seed_count;
      const inv = await tx.inventoryItem.findUnique({ where: { character_id_item_id: { character_id: characterId, item_id: itemId } } });
      if (inv && inv.quantity >= seed) {
        if (inv.quantity === seed) await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: characterId, item_id: itemId } } });
        else await tx.inventoryItem.update({ where: { character_id_item_id: { character_id: characterId, item_id: itemId } }, data: { quantity: { decrement: seed } } });
        await tx.orchardPlot.update({ where: { character_id_slot: { character_id: characterId, slot } }, data: { item_id: itemId, seed_count: seed, accrued: 0, ticks_banked: 0, last_tick_at: new Date() } });
        replanted = true;
      }
    }
    if (!replanted) {
      await tx.orchardPlot.update({ where: { character_id_slot: { character_id: characterId, slot } }, data: { item_id: null, seed_count: 0, accrued: 0, ticks_banked: 0, last_tick_at: new Date() } });
    }
    const name = ITEMS[itemId]?.name ?? itemId;
    const msg = harvested > 0 ? `Harvested ${harvested} ${name}.` : `No ${name} this time.`;
    return { success: true, message: replant && !replanted ? `${msg} (not enough to replant)` : msg, harvested, item_id: itemId, replanted };
  });
}

app.post('/api/orchard/harvest', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const body = req.body as { slot?: number; replant?: boolean };
  res.json(await orchardHarvest(chars[0].id, Math.trunc(Number(body.slot)), !!body.replant));
});

app.post('/api/orchard/clear', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const slot = Math.trunc(Number((req.body as { slot?: number }).slot));
  await prisma.orchardPlot.updateMany({
    where: { character_id: chars[0].id, slot },
    data: { item_id: null, seed_count: 0, accrued: 0, ticks_banked: 0, last_tick_at: new Date() },
  }).catch(() => {});
  res.json({ success: true, message: 'Plot cleared.' });
});

// Set a plot's fertilizer (absolute), clamped to what's free in the pool (= plots).
app.post('/api/orchard/fertilize', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];
  const body = req.body as { slot?: number; fertilizer?: number };
  const slot = Math.trunc(Number(body.slot));
  const want = Math.max(0, Math.trunc(Number(body.fertilizer)));
  const ljLevel = await lumberjackLevel(char.id);
  const { plots } = orchardCapacity(ljLevel);
  if (!(slot >= 0 && slot < plots)) { res.json({ success: false, message: 'That plot is locked.' }); return; }
  const pool = fertilizerPool(ljLevel);

  const result = await prisma.$transaction(async tx => {
    const rows = await tx.orchardPlot.findMany({ where: { character_id: char.id } });
    const usedOther = rows.filter(r => r.slot !== slot).reduce((s, r) => s + r.fertilizer, 0);
    const set = Math.max(0, Math.min(want, pool - usedOther));
    await tx.orchardPlot.upsert({
      where: { character_id_slot: { character_id: char.id, slot } },
      update: { fertilizer: set },
      create: { character_id: char.id, slot, fertilizer: set },
    });
    return { success: true, fertilizer: set };
  });
  res.json(result);
});

// ---- Global quests (Town Square) ----
startQuestScheduler(prisma, join(__dirname, '../../database/quests'));

// Town Square state: active quest cards (progress, your deposit, leaderboard), or none.
app.get('/api/townsquare', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const active = await prisma.globalQuest.findMany({ where: { status: 'active' }, orderBy: { ends_at: 'asc' } });

  const quests = await Promise.all(active.map(async q => {
    const [myDep, topDeps, inv] = await Promise.all([
      prisma.questDeposit.findUnique({ where: { quest_id_character_id: { quest_id: q.id, character_id: char.id } } }),
      prisma.questDeposit.findMany({ where: { quest_id: q.id }, orderBy: [{ quantity: 'desc' }, { created_at: 'asc' }], take: 10 }),
      prisma.inventoryItem.findUnique({ where: { character_id_item_id: { character_id: char.id, item_id: q.item_id } } }),
    ]);
    const names   = topDeps.length ? await prisma.character.findMany({ where: { id: { in: topDeps.map(d => d.character_id) } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(names.map(n => [n.id, n.name]));
    return {
      id: q.id, name: q.name, lore: q.lore,
      item_id: q.item_id, item_name: ITEMS[q.item_id]?.name ?? q.item_id,
      target: q.target, price: q.price, deposited: q.deposited, ends_at: q.ends_at,
      my_deposit:   myDep?.quantity ?? 0,
      my_inventory: inv?.quantity ?? 0,
      leaderboard:  topDeps.map((d, i) => ({ rank: i + 1, name: nameById.get(d.character_id) ?? '???', quantity: d.quantity, you: d.character_id === char.id })),
    };
  }));

  res.json({ characterName: char.name, quests });
});

// Deposit N of the quest item: removes them, pays N × the fixed price in korel,
// and advances the global + per-player totals. (Quest completes at its deadline,
// not at target — the full window stays open so people can climb the leaderboard.)
app.post('/api/quests/:id/deposit', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const questId  = String(req.params['id']);
  const quantity = Math.floor(Number((req.body as { quantity?: number }).quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) { res.json({ success: false, message: 'Enter a positive amount.' }); return; }

  const result = await prisma.$transaction(async tx => {
    const quest = await tx.globalQuest.findUnique({ where: { id: questId } });
    if (!quest || quest.status !== 'active' || new Date() >= quest.ends_at) return { success: false, message: 'This quest is not accepting deposits.' };

    const key = { character_id_item_id: { character_id: char.id, item_id: quest.item_id } };
    const inv = await tx.inventoryItem.findUnique({ where: key });
    if (!inv || inv.quantity < quantity) return { success: false, message: `You only have ${inv?.quantity ?? 0} to deposit.` };

    if (inv.quantity === quantity) await tx.inventoryItem.delete({ where: key });
    else await tx.inventoryItem.update({ where: key, data: { quantity: { decrement: quantity } } });

    const payout = quantity * quest.price;
    await tx.user.update({ where: { discord_id: discordId }, data: { korel: { increment: payout } } });
    await tx.globalQuest.update({ where: { id: questId }, data: { deposited: { increment: quantity } } });
    await tx.questDeposit.upsert({
      where:  { quest_id_character_id: { quest_id: questId, character_id: char.id } },
      update: { quantity: { increment: quantity } },
      create: { quest_id: questId, character_id: char.id, quantity },
    });
    const itemName = ITEMS[quest.item_id]?.name ?? quest.item_id;
    return {
      success: true,
      message: `Deposited ${quantity} ${itemName} for ${payout} korel.`,
      quest_name: quest.name,
      item_name:  itemName,
      quantity,
      deposited:  quest.deposited + quantity,
      target:     quest.target,
    };
  });

  res.json(result);

  // Mirror the contribution to the Town Square channel so progress shows in
  // Discord in real time (like shop buys/sells).
  if (result.success) {
    const r = result as unknown as {
      quest_name: string; item_name: string; quantity: number; deposited: number; target: number;
    };
    const mention = await playerMention(discordId, char.name);
    const pct = Math.min(100, Math.round((100 * r.deposited) / Math.max(1, r.target)));
    void pingChannel(
      worldConfig.channels.town_square,
      `${mention} contributed **${r.quantity} ${r.item_name}** to *${r.quest_name}* — now ${r.deposited.toLocaleString()}/${r.target.toLocaleString()} (${pct}%).`,
    );
  }
});

// ---- Socket.io ----

io.on('connection', (socket: Socket) => {
  console.log('client connected:', socket.id);

  socket.on('join_session', (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      socket.emit('error', { message: `Session ${sessionId} not found` });
      return;
    }
    socket.join(sessionId);
    const isTut = sessionMeta.get(sessionId)?.isTutorial ?? false;
    socket.emit('session_joined', { playerTeamId: 'team-a', isTutorial: isTut });
    socket.emit('session_state', session.toState());
    // Replay every captured round to a (re)joining client so the combat
    // log isn't empty when a player resumes mid-battle from the Hunt page.
    // meta.rounds already includes turn 0 (the initiative roll) plus every
    // turn's log lines, in order.
    const replayMeta = sessionMeta.get(sessionId);
    if (replayMeta && replayMeta.rounds.length > 0) {
      for (const round of replayMeta.rounds) {
        socket.emit('turn_result', { log: round.log });
      }
    } else if (session.initiativeLog.length > 0) {
      // Fallback for sessions older than rounds-tracking (test session, etc.)
      socket.emit('turn_result', { log: session.initiativeLog });
    }
    if (isTut) {
      socket.emit('tutorial_aside', { text: "There's the bird. Let's see what you've got." });
      socket.emit('tutorial_aside', { text: "The flow of battle moves between 3 phases: move > intent > resolve.  First, select your movement by clicking on your token, then clicking on the square to move to.  Then, select your action.  The turn will then auto resolve actions in order of 'move > defend > attack > special'.", isOOC: true });
    }
  });

  socket.on('submit_intent', async ({ sessionId, intent }: { sessionId: string; intent: CombatIntent }) => {
    const session = sessions.get(sessionId);
    if (!session || session.phase !== 'intent') return;

    const combatant = session.combatants.find(c => c.id === intent.combatantId);
    if (!combatant || combatant.isAI) return;

    // Validate moveTo is actually reachable (prevents client spoofing)
    if (intent.moveTo) {
      const occupied = new Set(
        session.combatants.filter(c => c.id !== combatant.id).flatMap(c => cellsOf(c).map(cell => `${cell.x},${cell.y}`))
      );
      const vMeta = session.meta.get(combatant.id);
      const vMove = vMeta ? effectiveMove(combatant.movementRange, vMeta.state) : combatant.movementRange;
      const reachable = reachableTiles(combatant.pos, vMove, session.board, occupied, combatant.size);
      if (!reachable.has(`${intent.moveTo.x},${intent.moveTo.y}`)) {
        intent.moveTo = null;
      }
    }

    session.pendingIntents.set(intent.combatantId, intent);
    if (!session.allHumansSubmitted()) return;

    for (const ai of session.aiCombatants()) {
      session.pendingIntents.set(ai.id, generateAIIntent(ai, session));
    }

    session.phase = 'resolving';
    const playerIntent = session.pendingIntents.get('player-1');

    // Lazy-start the downloadable replay on turn 1, while units are still at
    // their spawns (captured BEFORE resolveIntents moves them).
    let replay = session.replay;
    if (!replay) {
      replay = {
        version: 1,
        board: session.board.toJSON(),
        roster: session.combatants.map(c => {
          const m = session.meta.get(c.id);
          return {
            id: c.id, name: c.name, team: c.teamId,
            role: m?.weapon?.name ?? c.weaponInfo?.name ?? c.name,
            isAI: c.isAI, startPos: [c.pos.x, c.pos.y] as [number, number],
            maxHp: c.maxHp, initiative: c.initiative,
          };
        }),
        turns: [], result: null,
      };
      session.replay = replay;
    }

    const result = resolveIntents(session, session.pendingIntents);
    refreshTelegraphs(session);

    replay.turns.push({ turn: replay.turns.length + 1, intents: result.record.intents, log: result.log });
    if (result.winner) replay.result = { winner: result.winner, rounds: replay.turns.length };

    io.to(sessionId).emit('session_state', session.toState());
    io.to(sessionId).emit('turn_result', { log: result.log });

    const tutMeta = sessionMeta.get(sessionId);
    if (tutMeta) {
      tutMeta.rounds.push({ turn: session.turn, log: result.log });
      tutMeta.lastActivityAt = new Date();
    }
    if (tutMeta?.isTutorial && !result.winner) {
      // Situational coaching tied to the bird's NEXT action. The tutorial bird
      // walks a fixed pattern from index 0, so pattern[session.turn] is what it
      // does next turn. Each triangle lesson fires once, the first time that
      // situation comes up; the UI tour already covered the interface, so these
      // are pure combat tips.
      const enemy = session.aiCombatants()[0];
      const eMeta = enemy ? session.meta.get(enemy.id) : undefined;
      const playerC = session.combatants.find(c => !c.isAI);
      const pMeta = playerC ? session.meta.get(playerC.id) : undefined;
      const shown = (tutMeta.tutorialShown ??= new Set<string>());
      const tip = (key: string, text: string) => {
        if (shown.has(key)) return;
        shown.add(key);
        io.to(sessionId).emit('tutorial_aside', { text, isOOC: true });
      };
      // Walk the crit triangle one leg at a time, tied to the bird's NEXT action.
      switch (eMeta?.pattern[session.turn]?.type) {
        case PatternActionType.Defend: {
          // First lesson — introduce crits. If the player already landed one on
          // turn 1 (a Special into the guarding swallow), acknowledge it.
          const opener = (pMeta?.state.attack_crits ?? 0) > 0 ? 'That was a critical hit! ' : '';
          tip('vs-defend', opener + 'Crits trigger on a triangle: Defend ▶ Attack ▶ Special ▶ Defend — each beats the next. When your action beats what the enemy does, it lands a crit: a second effect on top of the action. The swallow will guard next turn, so aim a Special at its tile. (Special beats Defend.)');
          break;
        }
        case PatternActionType.Attack:
          tip('vs-attack', 'The swallow will strike next turn. Defend beats Attack — put up a guard to soften the hit and crit it as it swings.');
          break;
        case PatternActionType.Special:
          tip('vs-special', 'The swallow is winding up a Special next turn. Attack beats Special — hit it while it winds up to land a crit.');
          break;
      }

      // Once the triangle is taught, point out the enemy tell.
      if (session.turn >= 4) {
        tip('telegraph', "See the hint on the swallow's card? Enemies telegraph their next move with a tell — read it to know which action will beat them. Each new enemy type will behave differently, so be sure to watch their card to learn what possible actions they will take.");
      }

      // Safety net: if the fight drags on, Fendalok steps in so a stuck player
      // isn't stranded.
      if (session.turn >= 15) {
        io.to(sessionId).emit('tutorial_aside', { text: 'Tell you what — let me give you a hand.' });
        io.to(sessionId).emit('tutorial_aside', { text: 'Fendalok steps in and knocks the bird out of the air for you.', isOOC: true });
        for (const team of session.teams) {
          if (team.id === 'team-b') {
            for (const c of team.combatants) {
              c.hp = 0;
              const m = session.meta.get(c.id);
              if (m) m.state.health = 0;
            }
          }
        }
        io.to(sessionId).emit('session_state', session.toState());
        io.to(sessionId).emit('game_over', { winner: 'team-a' });
        tutMeta.endedAt = new Date();
        await prisma.user.update({
          where: { discord_id: tutMeta.discordUserId },
          data: { tutorial_complete: true },
        }).catch(() => {});
        io.to(sessionId).emit('reward_result', { summary: 'Tutorial complete.' });
        emitTutorialTips(sessionId);
      }
    }

    if (result.winner) {
      io.to(sessionId).emit('game_over', { winner: result.winner });
      const meta = sessionMeta.get(sessionId);
      // Stamp ended_at so the active-battles list hides this session before
      // the 10-minute cleanup timer fires (timer can't run shorter — players
      // need the reward UI to stay rendered).
      if (meta) meta.endedAt = new Date();

      if (meta && result.winner === 'team-a') {
        const chars = await charRepo.list(meta.discordUserId);
        const char = chars[0];
        let rewardSummary = 'No drops.';
        let korelEarned = 0;
        if (char) {
          // One grant per defeated enemy — each enemy's loot table rolls
          // independently. Sum up the results into a single rewards object so
          // the existing summary/reply logic still works.
          const rewards = await grantAllLoot(meta.discordUserId, char.id, meta.lootTables, meta.enemyName).catch(() => null);
          rewardSummary = rewards?.summary ?? 'No drops.';
          korelEarned = rewards?.currency ?? 0;
          await logBattlePerEnemy(session, meta, char.id, 'win', korelEarned, rewardSummary);
        }
        if (meta.isTutorial) {
          await prisma.user.update({
            where: { discord_id: meta.discordUserId },
            data: { tutorial_complete: true },
          }).catch(() => {});
        }
        io.to(sessionId).emit('reward_result', { summary: `Loot: ${rewardSummary}` });
        if (meta.isTutorial) emitTutorialTips(sessionId);
        if (discord) {
          try {
            const ch = await discord.channels.fetch(worldConfig.channels.forest);
            if (ch?.isTextBased() && 'send' in ch) {
              const mention = await playerMention(meta.discordUserId, char?.name ?? 'A hunter');
              const msg = rewardSummary !== 'No drops.'
                ? `${mention} returns from the forest!\n${rewardSummary}`
                : `${mention} returns from the forest. The ${meta.enemyName.toLowerCase()} didn't have anything interesting.`;
              await (ch as import('discord.js').TextChannel).send(msg);
            } else {
              console.warn('Battle win ping: forest channel not found or not text-based', worldConfig.channels.forest);
            }
          } catch (err) { console.error('Battle win ping failed:', err); }
        }
      }

      if (meta && result.winner === 'team-b') {
        const chars = await charRepo.list(meta.discordUserId).catch(() => []);
        const char = chars[0];
        const dbUser = await prisma.user.findUnique({ where: { discord_id: meta.discordUserId } }).catch(() => null);
        const currentKorel = dbUser?.korel ?? 0;
        const fee = Math.floor(currentKorel * 0.1);
        if (fee > 0) {
          await prisma.user.update({
            where: { discord_id: meta.discordUserId },
            data: { korel: { decrement: fee } },
          }).catch(() => {});
          await prisma.korelLedger.create({ data: {
            discord_id: meta.discordUserId, amount: -fee,
            reason: 'heal_fee', note: `Defeated by ${meta.enemyName}`,
          }}).catch(() => {});
        }
        if (char) {
          await logBattlePerEnemy(session, meta, char.id, 'loss', -fee, null);
        }
        const feeMsg = fee > 0 ? `Healing fee: −${fee} Korel` : 'No healing fee.';
        io.to(sessionId).emit('reward_result', { summary: feeMsg });
        if (discord) {
          try {
            const ch = await discord.channels.fetch(worldConfig.channels.forest);
            if (ch?.isTextBased() && 'send' in ch) {
              const mention = await playerMention(meta.discordUserId, char?.name ?? 'A hunter');
              const msg = fee > 0
                ? `${mention} was defeated by the ${meta.enemyName.toLowerCase()} and paid ${fee} Korel in healing fees.`
                : `${mention} was defeated by the ${meta.enemyName.toLowerCase()} and returned empty-handed.`;
              await (ch as import('discord.js').TextChannel).send(msg);
            } else {
              console.warn('Battle loss ping: forest channel not found or not text-based', worldConfig.channels.forest);
            }
          } catch (err) { console.error('Battle loss ping failed:', err); }
        }
      }

      // Clean up session after 10 minutes
      setTimeout(() => {
        sessions.delete(sessionId);
        sessionMeta.delete(sessionId);
      }, 10 * 60 * 1000);
    }
  });

  socket.on('reset_session', async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    const oldMeta = sessionMeta.get(sessionId);
    sessionMeta.delete(sessionId);

    const enemyKey = (VALID_ENEMIES.find(k =>
      session.combatants.some(c => c.isAI && c.name.toLowerCase().includes(k))
    ) ?? 'lithkem_swallow') as EnemyKey;

    let playerName = 'Hero';
    let playerWeaponKey = 'branch';
    let playerUpgrades: unknown = null;
    const playerSprite = session.combatants.find(c => !c.isAI)?.sprite;
    if (oldMeta) {
      const chars = await charRepo.list(oldMeta.discordUserId).catch(() => []);
      if (chars[0]) {
        playerName = chars[0].name;
        const equipped = await equippedWeaponForCombat(chars[0]);
        playerWeaponKey = equipped?.key ?? 'branch';
        playerUpgrades  = equipped?.upgrades ?? null;
      }
    }

    const { session: fresh, lootTables, enemyName } = createSession(sessionId, enemyKey, playerSprite, playerName, playerWeaponKey, oldMeta?.isTutorial ?? false, playerUpgrades);
    sessions.set(sessionId, fresh);
    if (oldMeta) {
      const freshRounds: { turn: number; log: string[] }[] = fresh.initiativeLog.length > 0
        ? [{ turn: 0, log: fresh.initiativeLog }]
        : [];
      const nowReset = new Date();
      const weaponUpgrades = (playerUpgrades as { upgradesDone?: number } | null)?.upgradesDone ?? 0;
      sessionMeta.set(sessionId, { ...oldMeta, lootTables, enemyKey, enemyName, weaponKey: playerWeaponKey, weaponUpgrades, startedAt: nowReset, lastActivityAt: nowReset, endedAt: null, rounds: freshRounds });
    }
    io.to(sessionId).emit('session_joined', { playerTeamId: 'team-a', isTutorial: oldMeta?.isTutorial ?? false });
    io.to(sessionId).emit('session_state', fresh.toState());
  });

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id);
  });

  // ---- Trade Socket.io ----

  // Per-viewer trade_state broadcast. Each socket in the room gets a session
  // projected through tradeSessionView so {you, them} are populated for their
  // own discordId — the client code reads state.you / state.them.
  const broadcastTradeState = (tradeId: string, session: TradeSession): void => {
    const room = io.sockets.adapter.rooms.get(`trade-${tradeId}`);
    if (!room) return;
    for (const socketId of room) {
      const s = io.sockets.sockets.get(socketId);
      if (!s) continue;
      const viewerId = resolveSocketAuth(s);
      if (!viewerId) continue;
      s.emit('trade_state', tradeSessionView(session, viewerId));
    }
  };

  socket.on('join_trade', async ({ tradeId }: { tradeId: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = resolveSocketAuth(socket);
    if (!session || !discordId || !session.players.find(p => p.discordId === discordId)) return;
    socket.join(`trade-${tradeId}`);
    if (session.status === 'waiting' && (io.sockets.adapter.rooms.get(`trade-${tradeId}`)?.size ?? 0) >= 2) {
      session.status = 'active';
    }
    broadcastTradeState(tradeId, session);
  });

  socket.on('trade_offer', ({ tradeId, offer }: { tradeId: string; offer: Partial<TradeOffer> }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = resolveSocketAuth(socket);
    const player = session?.players.find(p => p.discordId === discordId);
    if (!session || !player || player.locked) return;
    player.offer = {
      // Drop unlock items defensively in case a client sends them — they're
      // permanent character-bound and can't change hands.
      items:   (offer.items ?? []).filter(o => o.quantity > 0 && !isUnlock(o.itemId)),
      weapons: (offer.weapons ?? [])
        .filter((w): w is TradeWeaponEntry => !!w && typeof w.id === 'string')
        .map(w => ({ id: w.id, name: String(w.name ?? 'weapon'), bonus: Number(w.bonus) || 0 })),
      korel:   Math.max(0, Math.floor(Number(offer.korel ?? 0))),
    };
    broadcastTradeState(tradeId, session);
  });

  socket.on('trade_lock', ({ tradeId }: { tradeId: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = resolveSocketAuth(socket);
    const player = session?.players.find(p => p.discordId === discordId);
    if (!session || !player) return;
    player.locked = !player.locked;
    if (!player.locked) player.confirmed = false;
    broadcastTradeState(tradeId, session);
  });

  socket.on('trade_confirm', async ({ tradeId }: { tradeId: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = resolveSocketAuth(socket);
    const player = session?.players.find(p => p.discordId === discordId);
    if (!session || !player || !player.locked) return;
    player.confirmed = true;
    broadcastTradeState(tradeId, session);

    if (session.players.every(p => p.confirmed)) {
      session!.status = 'complete';
      const [a, b] = session!.players;
      try {
        const charA = (await charRepo.list(a.discordId))[0];
        const charB = (await charRepo.list(b.discordId))[0];
        if (!charA || !charB) throw new Error('Character not found');
        await prisma.$transaction(async tx => {
          // helper: transfer one side's offer (giver → receiver)
          const transfer = async (
            giver:    typeof charA,
            receiver: typeof charA,
            giverName: string,
            offer:     TradeOffer,
          ): Promise<void> => {
            // Items
            for (const { itemId, quantity } of offer.items) {
              const inv = await tx.inventoryItem.findUnique({ where: { character_id_item_id: { character_id: giver.id, item_id: itemId } } });
              if (!inv || inv.quantity < quantity) throw new Error(`${giverName} doesn't have enough ${itemId}`);
              await tx.inventoryItem.update({ where: { character_id_item_id: { character_id: giver.id, item_id: itemId } }, data: { quantity: { decrement: quantity } } });
              await tx.inventoryItem.upsert({
                where:  { character_id_item_id: { character_id: receiver.id, item_id: itemId } },
                update: { quantity: { increment: quantity } },
                create: { character_id: receiver.id, item_id: itemId, quantity },
              });
            }
            // Weapons (CharacterWeapon instance ownership transfer)
            for (const { id: weaponId } of offer.weapons) {
              const w = await tx.characterWeapon.findUnique({ where: { id: weaponId } });
              if (!w || w.character_id !== giver.id) throw new Error(`${giverName} no longer owns one of the offered weapons.`);
              if (giver.equipped_weapon_id === weaponId) throw new Error(`${giverName} can't trade an equipped weapon.`);
              await tx.characterWeapon.update({ where: { id: weaponId }, data: { character_id: receiver.id } });
            }
            // Korel
            if (offer.korel > 0) {
              const fresh = await tx.user.findUnique({ where: { discord_id: giver.discord_id } });
              if (!fresh || fresh.korel < offer.korel) throw new Error(`${giverName} doesn't have ${offer.korel} korel.`);
              await tx.user.update({ where: { discord_id: giver.discord_id },    data: { korel: { decrement: offer.korel } } });
              await tx.user.update({ where: { discord_id: receiver.discord_id }, data: { korel: { increment: offer.korel } } });
              await tx.korelLedger.create({ data: {
                discord_id: giver.discord_id, amount: -offer.korel, reason: 'trade',
                note: `Trade ${tradeId} with ${receiver.discord_id}`,
              }});
              await tx.korelLedger.create({ data: {
                discord_id: receiver.discord_id, amount: offer.korel, reason: 'trade',
                note: `Trade ${tradeId} with ${giver.discord_id}`,
              }});
            }
          };
          await transfer(charA, charB, a.charName, a.offer);
          await transfer(charB, charA, b.charName, b.offer);
        });
        await prisma.eventLog.create({ data: {
          discord_id: a.discordId, event_type: 'trade_completed',
          payload: { trade_id: tradeId, with: b.discordId, gave: a.offer, received: b.offer } as unknown as Prisma.InputJsonValue,
        }}).catch(() => {});
        await prisma.eventLog.create({ data: {
          discord_id: b.discordId, event_type: 'trade_completed',
          payload: { trade_id: tradeId, with: a.discordId, gave: b.offer, received: a.offer } as unknown as Prisma.InputJsonValue,
        }}).catch(() => {});
        io.to(`trade-${tradeId}`).emit('trade_complete', { message: 'Trade complete!' });
      } catch (err: unknown) {
        session!.status = 'cancelled';
        io.to(`trade-${tradeId}`).emit('trade_error', { message: err instanceof Error ? err.message : 'Trade failed.' });
      }
      setTimeout(() => tradeSessions.delete(tradeId), 60_000);
    }
  });

  socket.on('trade_cancel', ({ tradeId }: { tradeId: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = resolveSocketAuth(socket);
    if (!session || !session.players.find(p => p.discordId === discordId)) return;
    session.status = 'cancelled';
    broadcastTradeState(tradeId, session);
    setTimeout(() => tradeSessions.delete(tradeId), 60_000);
  });
});

// Retroactively grant trophy items to characters who already have wins in
// BattleLog from before the trophy system existed. Idempotent — the upsert
// path's update:{} is a no-op, so re-running just walks the list and finds
// everything already in place. Bounded by character count × enemy count
// (small) so the boot cost is fine.
async function backfillTrophies(): Promise<void> {
  try {
    const ENEMY_KEY_BY_NAME = new Map<string, string>();
    for (const file of fs.readdirSync(join(__dirname, '../../database/enemies')).filter(f => f.endsWith('.yaml') && !f.startsWith('tutorial_'))) {
      const ek = file.replace('.yaml', '');
      const summary = loadEnemySummary(ek as EnemyKey);
      if (summary) ENEMY_KEY_BY_NAME.set(summary.name, ek);
    }
    const winRows = await prisma.battleLog.groupBy({
      by: ['character_id', 'enemy'],
      where: { outcome: 'win' },
      _count: { _all: true },
    });
    let granted = 0;
    for (const row of winRows) {
      const enemyKey = ENEMY_KEY_BY_NAME.get(row.enemy);
      if (!enemyKey) continue;
      const trophyId = trophyIdFor(enemyKey);
      if (!ITEMS[trophyId]) continue;
      await prisma.item.upsert({
        where:  { id: trophyId },
        update: {},
        create: { id: trophyId, name: ITEMS[trophyId].name, description: ITEMS[trophyId].description },
      }).catch(() => {});
      const r = await prisma.inventoryItem.upsert({
        where:  { character_id_item_id: { character_id: row.character_id, item_id: trophyId } },
        update: {},
        create: { character_id: row.character_id, item_id: trophyId, quantity: 1 },
      }).catch(() => null);
      if (r) granted += 1;
    }
    if (granted > 0) console.log(`[boot] trophy backfill walked ${winRows.length} (char × enemy) pair(s)`);
  } catch (err) {
    console.error('[boot] backfillTrophies failed:', err);
  }
}

// One-time pass at boot to enforce the "unlock items have quantity 1" rule.
// Players had piles of swallow_bait before it changed to an unlock type;
// this clamps them all down on the next boot. Idempotent — running again
// when nothing's wrong is a no-op.
async function clampUnlockQuantities(): Promise<void> {
  try {
    const unlockIds = Object.entries(ITEMS).filter(([_, v]) => v.type === 'unlock').map(([k]) => k);
    if (unlockIds.length === 0) return;
    const overstuffed = await prisma.inventoryItem.findMany({
      where: { item_id: { in: unlockIds }, quantity: { gt: 1 } },
    });
    if (overstuffed.length === 0) return;
    await prisma.inventoryItem.updateMany({
      where: { item_id: { in: unlockIds }, quantity: { gt: 1 } },
      data:  { quantity: 1 },
    });
    console.log(`[boot] clamped ${overstuffed.length} unlock inventory row(s) to quantity 1`);
  } catch (err) {
    console.error('[boot] clampUnlockQuantities failed:', err);
  }
}

const PORT = process.env.PORT ?? 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Test session: http://localhost:${PORT}/battle/test`);
  void clampUnlockQuantities();
  void backfillTrophies();
});

// ---- Proactive shop tick ----
// Was lazy (only fired when a player loaded a shop page). Now an hourly
// sweep walks every shop yaml and ticks any item whose 24-hour interval
// has elapsed. Same maybeTickDaily logic — just driven by setInterval
// instead of pageload. Lets stock drift (restock + destock-at-75%) feel
// like the world exists between visits.
//
// IMPORTANT: SHOP_DIR is declared further down (with the other shop/recipe
// path constants). The initial kick + setInterval registration happen here
// at module load, but they reference SHOP_DIR through the runShopTick
// closure — so we have to defer the first invocation until after SHOP_DIR
// is bound. Calling `void runShopTick()` synchronously here would hit a
// TDZ error ("Cannot access 'SHOP_DIR' before initialization").
const SHOP_TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — sweep granularity for the 4h price gate
async function runShopTick(): Promise<void> {
  try {
    const n = await tickAllDue(SHOP_DIR);
    if (n > 0) console.log(`[shop tick] ticked ${n} item(s)`);
  } catch (err) { console.error('[shop tick] failed', err); }
}
setImmediate(() => { void runShopTick(); });
setInterval(runShopTick, SHOP_TICK_INTERVAL_MS);

// ---- Discord bot ----

function isAdmin(member: GuildMember | APIInteractionGuildMember): boolean {
  return 'cache' in member.roles
    ? member.roles.cache.has(worldConfig.admin_role)
    : (member.roles as string[]).includes(worldConfig.admin_role);
}

function isDev(userId: string): boolean {
  return worldConfig.dev.includes(userId);
}

// Returns the right way to identify a player in a Discord channel post,
// based on their ping_on_action setting:
//   true  → "<@discordId>" (actual ping, notifies them)
//   false → "**Character Name**" (bold name, no ping — the default)
// Welcome / first-character flows still hard-code the ping since the user
// hasn't picked a character name yet at that point.
async function playerMention(discordId: string, charName: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { discord_id: discordId },
    select: { ping_on_action: true },
  }).catch(() => null);
  return u?.ping_on_action ? `<@${discordId}>` : `**${charName}**`;
}

// Writes one BattleLog row per enemy fought, so multi-enemy spawns show
// 2 sulfolk in the dev stats instead of 1 "sulfolk encounter". Player-side
// metrics (hp_left, damage_received, rounds_count) are duplicated across
// rows — they describe the battle, not the enemy. korel_delta is split
// evenly among rows so SUM stays accurate.
async function logBattlePerEnemy(
  session: CombatSession,
  meta: NonNullable<ReturnType<typeof sessionMeta.get>>,
  characterId: string,
  outcome: 'win' | 'loss' | 'forfeit',
  korelDelta: number,
  lootSummary: string | null,
): Promise<void> {
  // The reaper deletes dead combatants from session.meta + team rosters
  // mid-battle, so by the time game_over fires the winning side is the only
  // one still in session.combatants. Read both pools to get the full roster.
  const allCombatants = [
    ...session.combatants.map(c => ({ combatant: c, state: session.meta.get(c.id)?.state })),
    ...session.deadCombatants.map(d => ({ combatant: d.combatant, state: d.meta.state })),
  ];
  const playerEntry = allCombatants.find(e => e.combatant.id === 'player-1');
  const enemies     = allCombatants.filter(e => e.combatant.isAI);
  if (enemies.length === 0) return;

  const playerState     = playerEntry?.state;
  const playerHpLeft    = playerState?.health ?? 0;
  const damageReceived  = playerState?.damage_taken ?? 0;
  const roundsCount     = meta.rounds.filter(r => r.turn > 0).length;
  const critCount       = playerState?.attack_crits ?? 0;
  const aimedAttempted  = playerState?.aimed_attempted ?? 0;
  const aimedHit        = playerState?.aimed_hit ?? 0;
  const restores        = playerState?.restores ?? 0;
  // Lower initiativeRank = acts sooner. Player went first iff their rank
  // is the lowest of any combatant in the session.
  const minEnemyRank    = enemies.reduce((m, e) => Math.min(m, e.combatant.initiativeRank), Number.POSITIVE_INFINITY);
  const playerWentFirst = playerEntry != null && playerEntry.combatant.initiativeRank < minEnemyRank;
  const korelShareBase  = Math.trunc(korelDelta / enemies.length);
  const korelRemainder  = korelDelta - korelShareBase * enemies.length;

  for (let i = 0; i < enemies.length; i++) {
    const { combatant: c, state: enemyState } = enemies[i];
    const damageDealt = enemyState?.damage_taken ?? 0;
    const enemyHpLeft = enemyState?.health ?? 0;
    // Strip the A/B suffix so all rows for the same enemy type aggregate
    // under one key in the dev stats page.
    const baseName = c.name.replace(/ [A-Z]$/, '');
    const korelForRow = korelShareBase + (i === 0 ? korelRemainder : 0);
    const battleLog = await prisma.battleLog.create({ data: {
      discord_id:        meta.discordUserId,
      character_id:      characterId,
      enemy:             baseName,
      outcome,
      korel_delta:       korelForRow,
      loot:              i === 0 ? lootSummary : null,
      started_at:        meta.startedAt,
      version:           APP_VERSION,
      weapon_key:        meta.weaponKey,
      weapon_upgrades:   meta.weaponUpgrades,
      player_hp_left:    playerHpLeft,
      enemy_hp_left:     enemyHpLeft,
      damage_dealt:      damageDealt,
      damage_received:   damageReceived,
      rounds_count:      roundsCount,
      crit_count:        critCount,
      aimed_attempted:   aimedAttempted,
      aimed_hit:         aimedHit,
      restores,
      player_went_first: playerWentFirst,
    }}).catch(() => null);
    // Round log is shared across the battle; only attach it once.
    if (battleLog && i === 0 && meta.rounds.length > 0) {
      await prisma.battleRoundLog.create({ data: {
        battle_id: battleLog.id,
        rounds: meta.rounds as unknown as Prisma.InputJsonValue,
      } }).catch(() => {});
    }
  }

  // Trophy grant on real wins (not tutorial, not losses, not forfeits).
  // First win for this enemy unlocks the trophy item; subsequent wins are
  // no-ops since unlock items are quantity 1. The "defeated N times" count
  // shown on the inventory page is queried live from BattleLog at render
  // time, so the item only ever needs to be granted once.
  if (outcome === 'win' && !meta.isTutorial) {
    const trophyId = trophyIdFor(meta.enemyKey);
    if (ITEMS[trophyId]) {
      await prisma.item.upsert({
        where:  { id: trophyId },
        update: {},
        create: { id: trophyId, name: ITEMS[trophyId].name, description: ITEMS[trophyId].description },
      }).catch(() => {});
      await prisma.inventoryItem.upsert({
        where:  { character_id_item_id: { character_id: characterId, item_id: trophyId } },
        update: {}, // already owned — no-op
        create: { character_id: characterId, item_id: trophyId, quantity: 1 },
      }).catch(() => {});
    }
  }
}

function buildWelcomeEmbed(
  mention: string,
  opts: { link?: string } = {},
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const button = opts.link
    ? new ButtonBuilder().setLabel('Create your character').setStyle(ButtonStyle.Link).setURL(opts.link)
    : new ButtonBuilder().setLabel('Create your character').setStyle(ButtonStyle.Primary).setCustomId('CreateChar_Begin');
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle('Welcome to Idya')
        .setDescription(
          `${mention}\n\n` +
          'Become part of a community built around a dynamic, living world.\n\n' +
          'Idya is a tabletop RPG that doesn\'t need a dungeon master.  The world runs itself.  Hunt creatures, craft and trade, and carve out your own place in a fantastical world.\n\n' +
          'Create your character below.\n\n' +
          '> *Idya is in early alpha, so expect rough edges. Reach out anytime with questions or issues.*'
        ),
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  };
}

// Closing wrap-up shown once the tutorial fight ends (a real win or the
// safety-net intervention). Functional, short — one warm line then the takeaways.
function emitTutorialTips(sessionId: string): void {
  io.to(sessionId).emit('tutorial_aside', { text: "Nice work — that's the core of it." });
  io.to(sessionId).emit('tutorial_aside', { text: 'Two things for the road: every creature fights in its own style and reacts to the moment, so learn how each one tends to behave; and your damage varies each hit, but blocking and healing yourself is reliable.', isOOC: true });
  io.to(sessionId).emit('tutorial_aside', { text: 'Head to town to sell your loot and gear up. Good luck out there.', isOOC: true });
}

// Spin up a fresh tutorial session for an existing character. Returns the
// session id. Used by bootstrapNewCharacter and by /api/layout when an
// existing player returns to /app with tutorial_complete=false but no
// active tutorial in memory (e.g., they closed the tab before finishing).
function startTutorialSession(discordId: string, spriteKey: string | null): string {
  const sessionId = Math.random().toString(36).slice(2, 10);
  const playerSprite = spriteKey ? `${HOST}/sprites/${spriteKey}.png` : undefined;
  const { session: tutSession, lootTables, enemyName } = createSession(sessionId, 'lithkem_swallow', playerSprite, 'Hero', 'branch', true);
  sessions.set(sessionId, tutSession);
  const tutorialRounds: { turn: number; log: string[] }[] = tutSession.initiativeLog.length > 0
    ? [{ turn: 0, log: tutSession.initiativeLog }]
    : [];
  const now = new Date();
  sessionMeta.set(sessionId, { discordUserId: discordId, isTutorial: true, lootTables, enemyKey: 'lithkem_swallow', enemyName, weaponKey: 'branch', weaponUpgrades: 0, startedAt: now, lastActivityAt: now, endedAt: null, rounds: tutorialRounds });
  return sessionId;
}

function findActiveTutorialSession(discordId: string): string | null {
  for (const [id, m] of sessionMeta.entries()) {
    if (m.discordUserId === discordId && m.isTutorial && !m.endedAt) return id;
  }
  return null;
}

// Character creation + tutorial-session bootstrap. Used by /api/character/create.
async function bootstrapNewCharacter(
  discordId: string,
  input: { name: string; bio?: string; nationality: Nationality; spriteKey: string },
): Promise<{ ok: true; sessionUrl: string } | { ok: false; error: string }> {
  if (!input.name || input.name.trim().length === 0) return { ok: false, error: 'Name is required.' };
  if (input.name.length > 32) return { ok: false, error: 'Name max 32 characters.' };
  if (input.bio && input.bio.length > 300) return { ok: false, error: 'Bio max 300 characters.' };
  if (!VALID_NATIONALITIES.includes(input.nationality)) return { ok: false, error: 'Invalid nationality.' };
  if (!SPRITES.find(s => s.key === input.spriteKey)) return { ok: false, error: 'Invalid sprite.' };
  const existing = await charRepo.list(discordId);
  if (existing.length > 0) return { ok: false, error: 'You already have a character.' };

  await charRepo.create(discordId, input.name, 'branch', input.spriteKey, input.nationality, input.bio);
  const sessionId = startTutorialSession(discordId, input.spriteKey);
  return { ok: true, sessionUrl: `/battle/${sessionId}` };
}

const HOST        = process.env.HOST_URL ?? `http://localhost:${PORT}`;
const SHOP_DIR    = join(__dirname, '../../database/shops');
const RECIPES_DIR = join(__dirname, '../../database/recipes');

const PROFESSIONS = ['lumberjack', 'blacksmith', 'enchanter'] as const;
type ProfessionKey = typeof PROFESSIONS[number];
const PROFESSION_NAMES: Record<ProfessionKey, string> = {
  lumberjack: 'Lumberjack',
  blacksmith:  'Blacksmith',
  enchanter:   'Enchanter',
};
// Cost indexed by combined profession level (all professions summed). Cap is 30 (3 × 10).
// Index N = cost to go from combined level N to N+1. Tune after economy is set.
const PROFESSION_LEVEL_COSTS = [
  100, 300, 700, 1_500, 3_000, 6_000, 12_000, 22_000, 40_000, 75_000,         // combined 0–9
  140_000, 250_000, 450_000, 800_000, 1_400_000, 2_400_000, 4_200_000,        // combined 10–16
  7_200_000, 12_000_000, 20_000_000, 33_000_000, 54_000_000, 88_000_000,      // combined 17–22
  143_000_000, 230_000_000, 370_000_000, 590_000_000, 950_000_000,             // combined 23–27
  1_500_000_000, 2_400_000_000,                                                 // combined 28–29
];
const PROFESSION_MAX_LEVEL   = 10;
const PROFESSION_COMBINED_CAP = 30;

async function getCombinedLevel(characterId: string): Promise<number> {
  const rows = await prisma.characterProfession.findMany({ where: { character_id: characterId } });
  return rows.reduce((sum, r) => sum + r.level, 0);
}

function levelCost(combinedLevel: number): number | null {
  if (combinedLevel >= PROFESSION_COMBINED_CAP) return null;
  return PROFESSION_LEVEL_COSTS[combinedLevel] ?? PROFESSION_LEVEL_COSTS[PROFESSION_LEVEL_COSTS.length - 1];
}

const SHOP_TO_PROFESSION: Partial<Record<string, ProfessionKey>> = {
  blacksmith:      'blacksmith',
  lumberjack:      'lumberjack',
  enchanting_shop: 'enchanter',
};

let discord: import('discord.js').Client | null = null;
let discordToken: string | null = null;

async function notifyBotLog(title: string, color: number, fields: { name: string; value: string }[] = []): Promise<void> {
  const channelId = worldConfig.channels.bot_log;
  if (!discord || !channelId) return;
  try {
    const ch = await discord.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased() && 'send' in ch) {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setTimestamp()
        .addFields(fields.map(f => ({ ...f, value: String(f.value).slice(0, 1024) })));
      await (ch as import('discord.js').TextChannel).send({ embeds: [embed] });
    }
  } catch (_) {}
}

// Extract a single version's section from the Discord-facing changelog.
// CHANGELOG.md is the detailed dev-side log; CHANGELOG_DISCORD.md is the
// condensed, player-safe version posted to #updates.
function extractChangelogSection(version: string): string | null {
  const path = join(__dirname, '../../docs/CHANGELOG_DISCORD.md');
  if (!fs.existsSync(path)) return null;
  const md = fs.readFileSync(path, 'utf-8');
  // Split on '## ' h2 headings so each section starts with "VERSION ..." then body.
  const sections = md.split(/^## /m);
  for (const sec of sections) {
    if (!sec.startsWith(`${version} `) && !sec.startsWith(`${version}\n`)) continue;
    // Strip trailing '---' divider that separates from the next entry.
    return ('## ' + sec).replace(/\n---\s*\n[\s\S]*$/, '').trim();
  }
  return null;
}

// Read current version from package.json
function currentVersion(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version ?? null;
  } catch (_) { return null; }
}

// On startup: post the changelog for the current version to #updates, once.
async function maybeAnnounceVersion(): Promise<void> {
  const channelId = worldConfig.channels.updates;
  if (!discord || !channelId) return;
  const version = currentVersion();
  if (!version) return;

  const eventType = 'version_announced';
  const already = await prisma.eventLog.findFirst({
    where: { event_type: eventType, payload: { path: ['version'], equals: version } },
  }).catch(() => null);
  if (already) return;

  const section = extractChangelogSection(version);
  if (!section) return;

  try {
    const ch = await discord.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased() || !('send' in ch)) return;
    const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
    // Strip the leading "## VERSION — DATE" since it becomes the embed title.
    const body = section.replace(/^##\s+[^\n]*\n+/, '').trim();
    // Split into ~3800-char chunks on ### subheadings so each fits in an embed.
    const chunks = chunkByHeading(body, 3800);
    const gold = 0xe6af2e;
    const text = ch as import('discord.js').TextChannel;
    for (let i = 0; i < chunks.length; i++) {
      const embed = new EmbedBuilder().setColor(gold).setDescription(chunks[i]);
      if (i === 0) embed.setTitle(`Idya ${version}`);
      if (i === chunks.length - 1) embed.setFooter({ text: `Deployed to ${env}` }).setTimestamp();
      await text.send({
        content: i === 0 ? '@everyone' : undefined,
        embeds: [embed],
        allowedMentions: { parse: i === 0 ? ['everyone'] : [] },
      });
    }
    await prisma.eventLog.create({
      data: { discord_id: 'system', event_type: eventType, payload: { version, env } },
    });
  } catch (err) {
    console.error('Version announce failed:', err);
  }
}

// ---- Progression roles ----
// Discord roles players earn: a badge for each profession (first rank in it), a
// Journeyman role at total profession level ≥ 5, and Master at total ≥ 10.
// Add-only — milestones are permanent. Roles are auto-created in the guild on
// startup; needs the bot to have "Manage Roles" + a role positioned above these.
const ROLE_DEFS: Record<string, { name: string; color: number }> = {
  lumberjack: { name: 'Lumberjack', color: 0x4a9d3a },
  blacksmith: { name: 'Blacksmith', color: 0xc0682f },
  enchanter:  { name: 'Enchanter',  color: 0x9b59b6 },
  journeyman: { name: 'Journeyman', color: 0x3498db },
  master:     { name: 'Master',     color: 0xe0b020 },
};
const progressionRoleIds: Record<string, string> = {};

// Ensure the five roles exist in the guild, creating any that are missing. Returns
// how many are now usable vs failed (a failure usually = missing Manage Roles perm).
async function ensureProgressionRoles(): Promise<{ ok: number; failed: number; err?: string }> {
  let ok = 0, failed = 0, err: string | undefined;
  if (!discord) return { ok, failed, err: 'no discord client' };
  const guild = await discord.guilds.fetch(worldConfig.guild_id).catch(() => null);
  if (!guild) return { ok, failed, err: 'guild not found' };
  const existing = await guild.roles.fetch().catch(() => null);
  if (!existing) return { ok, failed, err: 'could not fetch roles' };
  for (const [key, def] of Object.entries(ROLE_DEFS)) {
    let role = existing.find(r => r.name === def.name) ?? null;
    if (!role) {
      role = await guild.roles.create({ name: def.name, color: def.color, reason: 'Idya progression role' })
        .catch(e => { err = e?.message ?? String(e); console.error(`ensureProgressionRoles: create ${def.name} failed`, err); return null; });
    }
    if (role) { progressionRoleIds[key] = role.id; ok++; } else failed++;
  }
  return { ok, failed, err };
}

// Which role keys a set of profession levels earns.
function earnedRoleKeys(levels: Record<string, number>): string[] {
  const keys: string[] = [];
  for (const prof of ['lumberjack', 'blacksmith', 'enchanter']) if ((levels[prof] ?? 0) >= 1) keys.push(prof);
  const total = (levels.lumberjack ?? 0) + (levels.blacksmith ?? 0) + (levels.enchanter ?? 0);
  if (total >= 5)  keys.push('journeyman');
  if (total >= 10) keys.push('master');
  return keys;
}

// Grant any roles a player has earned (never removes — milestones are permanent).
// Returns how many roles were newly added.
async function syncProgressionRoles(discordId: string): Promise<number> {
  if (!discord || Object.keys(progressionRoleIds).length === 0) return 0;
  const guild = discord.guilds.cache.get(worldConfig.guild_id);
  if (!guild) return 0;
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return 0;
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) return 0;
  const profRows = await prisma.characterProfession.findMany({ where: { character_id: chars[0].id } });
  const levels: Record<string, number> = {};
  for (const p of profRows) levels[p.profession] = p.level;
  let added = 0;
  for (const key of earnedRoleKeys(levels)) {
    const id = progressionRoleIds[key];
    if (id && !member.roles.cache.has(id)) {
      const done = await member.roles.add(id, 'Idya progression').then(() => true)
        .catch(err => { console.error(`role add ${key} for ${discordId} failed`, err?.message ?? err); return false; });
      if (done) added++;
    }
  }
  return added;
}

// Reconcile every player on startup: grant any earned-but-missing role. Runs on
// each restart (called from ClientReady), so it catches up anyone who leveled
// while the bot was down, or after a threshold/role change. Add-only, throttled.
async function backfillProgressionRoles(): Promise<{ players: number; granted: number }> {
  let players = 0, granted = 0;
  try {
    const rows = await prisma.character.findMany({ select: { discord_id: true } });
    for (const id of [...new Set(rows.map(r => r.discord_id))]) {
      players++;
      granted += await syncProgressionRoles(id);
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (err) { console.error('backfillProgressionRoles failed', err); }
  return { players, granted };
}

// Split a markdown body into chunks <= maxLen, breaking on '### ' subheadings
// when possible so each chunk is self-contained.
function chunkByHeading(body: string, maxLen: number): string[] {
  if (body.length <= maxLen) return [body];
  const parts = body.split(/(?=^### )/m);
  const out: string[] = [];
  let buf = '';
  for (const part of parts) {
    if (buf && buf.length + part.length > maxLen) {
      out.push(buf.trim());
      buf = '';
    }
    if (part.length > maxLen) {
      if (buf) { out.push(buf.trim()); buf = ''; }
      for (let i = 0; i < part.length; i += maxLen) out.push(part.slice(i, i + maxLen));
    } else {
      buf += part;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
try {
  discordToken = JSON.parse(
    fs.readFileSync(join(__dirname, '../../database/config.json'), 'utf-8')
  )[process.env.NODE_ENV === 'production' ? 'PROD' : 'DEV']?.['TOKEN'] ?? null;
} catch (_) {}

if (discordToken) {
  discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });
  // All Discord interactions fan out from ONE listener at the bottom of this
  // block. Each command/button registers a handler into interactionHandlers
  // instead of adding its own client.on() — the old pattern leaked ~17
  // listeners against Node's default 10-listener cap and fired a misleading
  // "memory leak" warning on every restart. Each handler is responsible for
  // its own filter (isChatInputCommand + commandName, isButton + customId,
  // etc.) and returns early if no match.
  const interactionHandlers: Array<(interaction: Interaction) => Promise<void>> = [];

  interactionHandlers.push(async (interaction) => {
    // ---- Hunt ----

    if (interaction.isChatInputCommand() && interaction.commandName === 'hunt') {
      if (interaction.channelId !== worldConfig.channels.forest) {
        await interaction.reply({ content: "You can only hunt in the forest.", flags: MessageFlags.Ephemeral });
        return;
      }
      const token = getOrCreateToken(interaction.user.id);
      await interaction.reply({
        content: `Sulkupa Forest awaits. ${HOST}/app/hunt?auth=${token}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // ---- Character creation ----
    // Whole flow lives in the SPA now (/app/create). Discord just hands the
    // user an auth-laden link.

    if (interaction.isChatInputCommand() && interaction.commandName === 'createcharacter') {
      const existing = await charRepo.list(interaction.user.id);
      if (existing.length > 0) {
        await interaction.reply({ content: 'You already have a character! Use `/profile` to view it.', flags: MessageFlags.Ephemeral });
        return;
      }
      const token = getOrCreateToken(interaction.user.id);
      const link  = `${HOST}/app/create?auth=${token}`;
      await interaction.reply({
        ...buildWelcomeEmbed(`<@${interaction.user.id}>`, { link }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'CreateChar_Begin') {
      const existing = await charRepo.list(interaction.user.id);
      if (existing.length > 0) {
        await interaction.reply({ content: 'You already have a character! Use `/profile` to view it.', flags: MessageFlags.Ephemeral });
        return;
      }
      const token = getOrCreateToken(interaction.user.id);
      await interaction.reply({
        content: `Register at the census log: ${HOST}/app/create?auth=${token}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  });

  // ---- Admin commands ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'admin') return;
    if (!interaction.member || !isAdmin(interaction.member)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'joinsim') {
      const target = interaction.options.getUser('user', true);
      const welcomeChannel = await interaction.guild?.channels.fetch(worldConfig.channels.welcome).catch(() => null);
      if (!welcomeChannel?.isTextBased() || !('send' in welcomeChannel)) {
        await interaction.reply({ content: 'Welcome channel not configured.', flags: MessageFlags.Ephemeral });
        return;
      }
      await (welcomeChannel as import('discord.js').TextChannel).send(buildWelcomeEmbed(`<@${target.id}>`));
      await interaction.reply({ content: `Posted welcome for ${target.username} in #welcome.`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'giveweapon') {
      const target = interaction.options.getUser('user', true);
      const weaponKey = interaction.options.getString('weapon', true).toLowerCase().trim();
      const DEV_ONLY_WEAPONS = ['honor'];
      if (DEV_ONLY_WEAPONS.includes(weaponKey) && !isDev(interaction.user.id)) {
        await interaction.reply({ content: `\`${weaponKey}\` is a dev-only weapon.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const weaponPath = join(__dirname, `../../database/weapons/${weaponKey}.yaml`);
      if (!fs.existsSync(weaponPath)) {
        await interaction.reply({ content: `No weapon found with key \`${weaponKey}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const chars = await charRepo.list(target.id);
      if (chars.length === 0) {
        await interaction.reply({ content: `${target.username} doesn't have a character.`, flags: MessageFlags.Ephemeral });
        return;
      }
      await prisma.characterWeapon.create({
        data: { character_id: chars[0].id, weapon_key: weaponKey },
      });
      const w = Weapon.from_file(weaponPath);
      await prisma.eventLog.create({ data: {
        discord_id: target.id,
        event_type: 'weapon_given',
        payload: { weapon_key: weaponKey, weapon_name: w.name, given_by: interaction.user.id },
      }}).catch(() => {});
      await interaction.reply({ content: `Added **${w.name}** to ${target.username}'s weapon inventory. They can equip it with \`/weapon\`.`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'givekorel') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      const user = await prisma.user.findUnique({ where: { discord_id: target.id } });
      if (!user) {
        await interaction.reply({ content: `${target.username} doesn't have an account.`, flags: MessageFlags.Ephemeral });
        return;
      }
      await prisma.$transaction([
        prisma.user.update({ where: { discord_id: target.id }, data: { korel: { increment: amount } } }),
        prisma.korelLedger.create({ data: {
          discord_id: target.id, amount,
          reason: 'admin_give', note: `given by ${interaction.user.username}`,
        }}),
      ]);
      const sign = amount >= 0 ? '+' : '';
      await interaction.reply({ content: `${sign}${amount.toLocaleString()} korel → ${target.username}.`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'giveitem') {
      const target   = interaction.options.getUser('user', true);
      const itemId   = interaction.options.getString('item', true).toLowerCase().trim();
      const rawQty   = interaction.options.getInteger('quantity') ?? 1;
      // Clamp to a sane range. The Discord integer option type accepts up to
      // 2^53, which overflows our INT4 column at 2^31; cap at 1 million —
      // anything larger is a typo, not a legitimate admin grant.
      const QTY_MAX  = 1_000_000;
      const quantity = Math.max(1, Math.min(QTY_MAX, rawQty));
      const itemDef = ITEMS[itemId];
      if (!itemDef) {
        await interaction.reply({ content: `No item found with ID \`${itemId}\`.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const chars = await charRepo.list(target.id);
      if (chars.length === 0) {
        await interaction.reply({ content: `${target.username} doesn't have a character.`, flags: MessageFlags.Ephemeral });
        return;
      }
      // Cap against the existing stack so an increment can't push past QTY_MAX
      // either. Belt-and-suspenders on the INT4 column.
      const existing = await prisma.inventoryItem.findUnique({
        where: { character_id_item_id: { character_id: chars[0].id, item_id: itemId } },
      });
      const wouldBe = (existing?.quantity ?? 0) + quantity;
      const effectiveQty = wouldBe > QTY_MAX ? Math.max(0, QTY_MAX - (existing?.quantity ?? 0)) : quantity;
      if (effectiveQty <= 0) {
        await interaction.reply({ content: `${target.username} already has ${(existing?.quantity ?? 0).toLocaleString()}× ${itemDef.name}, at or above the cap.`, flags: MessageFlags.Ephemeral });
        return;
      }
      await prisma.item.upsert({
        where:  { id: itemId },
        update: {},
        create: { id: itemId, name: itemDef.name, description: itemDef.description },
      });
      await prisma.inventoryItem.upsert({
        where:  { character_id_item_id: { character_id: chars[0].id, item_id: itemId } },
        update: { quantity: { increment: effectiveQty } },
        create: { character_id: chars[0].id, item_id: itemId, quantity: effectiveQty },
      });
      await interaction.reply({ content: `Gave ${effectiveQty}× **${itemDef.name}** to ${target.username}.`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'giveprofession') {
      const target     = interaction.options.getUser('user', true);
      const profession = interaction.options.getString('profession', true);
      const level      = interaction.options.getInteger('level', true);
      const chars = await charRepo.list(target.id);
      if (chars.length === 0) {
        await interaction.reply({ content: `${target.username} doesn't have a character.`, flags: MessageFlags.Ephemeral });
        return;
      }
      await prisma.characterProfession.upsert({
        where:  { character_id_profession: { character_id: chars[0].id, profession } },
        update: { level },
        create: { character_id: chars[0].id, profession, level },
      });
      const label = { lumberjack: 'Lumberjack', blacksmith: 'Blacksmith', enchanter: 'Enchanter' }[profession] ?? profession;
      await interaction.reply({ content: `Set ${target.username}'s **${label}** to level ${level}.`, flags: MessageFlags.Ephemeral });
    }
  });

  // ---- Dev commands ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'dev') return;
    if (!isDev(interaction.user.id)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'resetcharacter') {
      const target = interaction.options.getUser('user', true);
      try {
        const chars = await prisma.character.findMany({ where: { discord_id: target.id }, select: { id: true } });
        if (chars.length > 0) {
          const ids = chars.map(c => c.id);
          await prisma.inventoryItem.deleteMany({ where: { character_id: { in: ids } } });
          await prisma.characterWeapon.deleteMany({ where: { character_id: { in: ids } } });
          await prisma.characterProfession.deleteMany({ where: { character_id: { in: ids } } });
          await prisma.character.deleteMany({ where: { discord_id: target.id } });
        }
        await prisma.user.upsert({
          where: { discord_id: target.id },
          update: { tutorial_complete: false, korel: 0 },
          create: { discord_id: target.id, tutorial_complete: false, korel: 0 },
        });
        await prisma.eventLog.create({ data: {
          discord_id: target.id, event_type: 'character_reset',
          payload: { reset_by: interaction.user.id },
        }}).catch(() => {});
        await interaction.reply({ content: `Character reset for ${target.username}.`, flags: MessageFlags.Ephemeral });
      } catch (e) {
        await interaction.reply({ content: `Reset failed: ${e instanceof Error ? e.message : String(e)}`, flags: MessageFlags.Ephemeral });
      }
    }
  });

  // ---- Profile ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'profile') return;

    const chars = await charRepo.list(interaction.user.id);
    if (chars.length === 0) {
      await interaction.reply({
        content: "You don't have a character yet! Use `/createcharacter` to get started.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const char = chars[0];
    const dbUser = await prisma.user.findUnique({ where: { discord_id: interaction.user.id } });

    const professions = await prisma.characterProfession.findMany({ where: { character_id: char.id } });
    const ownedWeapons = await prisma.characterWeapon.findMany({
      where: { character_id: char.id },
      orderBy: { created_at: 'asc' },
    });
    const weaponsText = ownedWeapons.length > 0
      ? ownedWeapons.map(cw => {
          const w = Weapon.from_file(join(__dirname, `../../database/weapons/${cw.weapon_key}.yaml`));
          const bonus = weaponBonusCount(cw.weapon_key, cw.upgrades);
          const bonusStr = bonus > 0 ? ` +${bonus}` : '';
          const isEquipped = cw.id === char.equipped_weapon_id;
          return isEquipped ? `**${w.name}${bonusStr}** (equipped)` : `${w.name}${bonusStr}`;
        }).join('\n')
      : 'None';

    const inventory = await prisma.inventoryItem.findMany({
      where: { character_id: char.id },
      include: { item: true },
    });
    const invText = inventory.length > 0
      ? inventory.map(i => `${i.quantity}x ${i.item.name}`).join('\n')
      : 'Empty';

    const profMap: Record<string, string> = { lumberjack: 'Lumberjack', blacksmith: 'Blacksmith', enchanter: 'Enchanter' };
    const profText = Object.entries(profMap)
      .map(([key, label]) => {
        const lvl = professions.find(p => p.profession === key)?.level ?? 0;
        return `${label}: ${lvl}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x1a1a2e)
      .setTitle(char.name)
      .addFields(
        { name: 'HP',          value: `${char.health} / ${char.max_health}`, inline: true },
        { name: 'Korel',       value: `${dbUser?.korel ?? 0}`,              inline: true },
        { name: '​',      value: '​',                              inline: true },
        { name: 'Professions', value: profText,                              inline: false },
        { name: 'Weapons',     value: weaponsText,                           inline: false },
        { name: 'Inventory',   value: invText,                               inline: false },
      );

    if (char.sprite_token) {
      embed.setThumbnail(`${worldConfig.sprite_cdn}/${char.sprite_token}.png`);
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  });

  // ---- Weapon equip ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'weapon') return;

    const chars = await charRepo.list(interaction.user.id);
    if (chars.length === 0) {
      await interaction.reply({ content: "You don't have a character yet!", flags: MessageFlags.Ephemeral });
      return;
    }
    const char = chars[0];
    const ownedWeapons = await prisma.characterWeapon.findMany({
      where: { character_id: char.id },
      orderBy: { created_at: 'asc' },
    });
    if (ownedWeapons.length === 0) {
      await interaction.reply({ content: 'You have no weapons in your inventory.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Discord StringSelectMenu has a hard cap of 25 options. Prioritize equipped + highest bonus.
    const DISCORD_SELECT_MAX = 25;
    const ranked = ownedWeapons
      .map(cw => ({ cw, bonus: weaponBonusCount(cw.weapon_key, cw.upgrades) }))
      .sort((a, b) => {
        if (a.cw.id === char.equipped_weapon_id) return -1;
        if (b.cw.id === char.equipped_weapon_id) return 1;
        return b.bonus - a.bonus;
      });
    const shown = ranked.slice(0, DISCORD_SELECT_MAX);
    const omitted = ownedWeapons.length - shown.length;

    const options = shown.map(({ cw, bonus }) => {
      const w = Weapon.from_file(join(__dirname, `../../database/weapons/${cw.weapon_key}.yaml`));
      const label = bonus > 0 ? `${w.name} +${bonus}` : w.name;
      return new StringSelectMenuOptionBuilder()
        .setLabel(label.slice(0, 100))
        .setDescription((w.description || cw.weapon_key).slice(0, 100))
        .setValue(cw.id)
        .setDefault(cw.id === char.equipped_weapon_id);
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId('WeaponEquip')
      .setPlaceholder('Choose a weapon to equip')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const note = omitted > 0
      ? `Choose a weapon to equip (showing top ${DISCORD_SELECT_MAX}; ${omitted} more — use \`/character\` for the full list):`
      : 'Choose a weapon to equip:';
    await interaction.reply({ content: note, components: [row], flags: MessageFlags.Ephemeral });
  });

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'WeaponEquip') return;

    const chars = await charRepo.list(interaction.user.id);
    if (chars.length === 0) { await interaction.update({ content: 'No character found.', components: [] }); return; }
    const char = chars[0];

    const weaponId = interaction.values[0];
    const owned = await prisma.characterWeapon.findUnique({ where: { id: weaponId } });
    if (!owned || owned.character_id !== char.id) {
      await interaction.update({ content: "You don't own that weapon.", components: [] });
      return;
    }

    await prisma.character.update({ where: { id: char.id }, data: { equipped_weapon_id: weaponId } });
    const w = Weapon.from_file(join(__dirname, `../../database/weapons/${owned.weapon_key}.yaml`));
    await prisma.eventLog.create({ data: {
      discord_id: interaction.user.id, event_type: 'weapon_equipped',
      payload: { weapon_id: weaponId, weapon_key: owned.weapon_key, weapon_name: w.name },
    }}).catch(() => {});
    await interaction.update({ content: `**${w.name}** equipped.`, components: [] });
  });

  // ---- Shop ----

  const CHANNEL_TO_SHOP: Record<string, string> = {
    [worldConfig.channels.blacksmith]:      'blacksmith',
    [worldConfig.channels.general_store]:   'general_store',
    [worldConfig.channels.lumberjack]:      'lumberjack',
    [worldConfig.channels.enchanting_shop]: 'enchanting_shop',
  };

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'shop') return;

    const shopKey = CHANNEL_TO_SHOP[interaction.channelId];
    if (!shopKey) {
      await interaction.reply({ content: "There's no shop here.", flags: MessageFlags.Ephemeral });
      return;
    }

    const chars = await charRepo.list(interaction.user.id);
    if (chars.length === 0) {
      await interaction.reply({ content: "You don't have a character yet!", flags: MessageFlags.Ephemeral });
      return;
    }

    let token = userTokens.get(interaction.user.id);
    if (!token) {
      token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      authTokens.set(token, { discordUserId: interaction.user.id });
      userTokens.set(interaction.user.id, token);
    }

    const config = loadShop(shopKey, SHOP_DIR);
    await interaction.reply({
      content: `**${config.name}**\n${HOST}/app/shop/${shopKey}?auth=${token}`,
      flags: MessageFlags.Ephemeral,
    });
  });

  // ---- Craft ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'craft') return;

    const chars = await charRepo.list(interaction.user.id);
    if (chars.length === 0) {
      await interaction.reply({ content: "You don't have a character yet!", flags: MessageFlags.Ephemeral });
      return;
    }

    let token = userTokens.get(interaction.user.id);
    if (!token) {
      token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      authTokens.set(token, { discordUserId: interaction.user.id });
      userTokens.set(interaction.user.id, token);
    }

    await interaction.reply({
      content: `${HOST}/app/crafting?auth=${token}`,
      flags: MessageFlags.Ephemeral,
    });
  });

  // ---- Trade ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'trade') return;

    const target = interaction.options.getUser('user', true);
    if (target.bot) {
      await interaction.reply({ content: "You can't trade with a bot.", flags: MessageFlags.Ephemeral });
      return;
    }

    const result = await createTradeSession(interaction.user.id, target.id);
    if (!result.ok) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
      return;
    }
    const { tradeId, initiatorToken, targetToken } = result;

    await interaction.reply({
      content: `**Trade with ${target.username}**\n${HOST}/app/trade/${tradeId}?auth=${initiatorToken}`,
      flags: MessageFlags.Ephemeral,
    });

    try {
      await target.send(`**${interaction.user.username}** wants to trade with you!\n${HOST}/app/trade/${tradeId}?auth=${targetToken}`);
    } catch (_) {
      await interaction.followUp({
        content: `Could not DM ${target.username} — they may have DMs disabled. Share this link with them: ${HOST}/app/trade/${tradeId}?auth=${targetToken}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  });

  // ---- Weapons reference ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'weapon-stats') return;
    await interaction.reply({ content: `${HOST}/app/weapon-stats`, flags: MessageFlags.Ephemeral });
  });

  // ---- App page shortcuts ----

  const APP_PAGE_LINKS: Array<{ command: string; path: string }> = [
    { command: 'character',   path: '/character'   },
    { command: 'inventory',   path: '/inventory'   },
    { command: 'upgrading',   path: '/upgrade'     },
    { command: 'enchanting',  path: '/enchant'     },
    { command: 'professions', path: '/professions' },
    { command: 'enemies',     path: '/enemies'     },
  ];

  // All 6 page-link commands share the same handler body — one listener with
  // a lookup map instead of one listener per command (was the worst offender
  // for the MaxListeners warning).
  const appPageByCommand = new Map(APP_PAGE_LINKS.map(p => [p.command, p.path]));
  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const path = appPageByCommand.get(interaction.commandName);
    if (path === undefined) return;
    const token = getOrCreateToken(interaction.user.id);
    await interaction.reply({
      content: `${HOST}/app${path}?auth=${token}`,
      flags: MessageFlags.Ephemeral,
    });
  });

  // ---- Ping ----

  interactionHandlers.push(async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ping') return;
    await interaction.reply('Pong!');
  });

  // Single dispatcher — fans every interaction out to the handlers above.
  // Each handler's filter ignores interactions it doesn't own, so iteration
  // is effectively a routing table walk. Errors in one handler don't break
  // siblings.
  discord.on(Events.InteractionCreate, async (interaction) => {
    for (const handler of interactionHandlers) {
      try { await handler(interaction); }
      catch (err) { console.error('interaction handler error:', err); }
    }
  });

  // ---- Guild member join ----

  discord.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id !== worldConfig.guild_id) return;
    if (worldConfig.join_role) {
      await member.roles.add(worldConfig.join_role, 'Join role')
        .catch(err => console.error(`join role add for ${member.id} failed`, err?.message ?? err));
    }
    const channel = member.guild.channels.cache.get(worldConfig.channels.welcome);
    if (!channel?.isTextBased()) return;
    await channel.send(buildWelcomeEmbed(`<@${member.id}>`));
  });

  discord.once(Events.ClientReady, async () => {
    console.log(`Discord bot ready`);
    let commitLine = 'unknown';
    try {
      const { execSync } = await import('child_process');
      commitLine = execSync('git log -1 --format="%h %s"', { cwd: join(__dirname, '../..') }).toString().trim();
    } catch (_) {}
    const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
    await notifyBotLog(
      `🟢 Bot online (${env})`,
      env === 'prod' ? 0x2ecc71 : 0x3498db,
      [{ name: 'Commit', value: commitLine }],
    );
    await maybeAnnounceVersion();
    // Progression roles: ensure they exist and grant any earned-but-missing ones.
    // (Runs silently now that we've confirmed it fires; failures still hit console.)
    await ensureProgressionRoles();
    await backfillProgressionRoles();
  });

  discord.on('error', (err) => {
    console.error('Discord client error:', err.message);
    void notifyBotLog('⚠️ Discord client error', 0xe67e22, [{ name: 'Error', value: err.message }]);
  });

  // ---- Lifecycle notifications ----

  const shutdown = async (signal: string) => {
    console.log(`Shutting down (${signal})`);
    await notifyBotLog(`🔴 Bot going offline (${signal})`, 0xe74c3c);
    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(0)); });
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(0)); });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    const note = notifyBotLog('🔴 Bot crashed (uncaught exception)', 0xe74c3c, [
      { name: 'Error', value: err.message || String(err) },
      { name: 'Stack', value: err.stack ?? 'no stack' },
    ]);
    Promise.race([note, new Promise(r => setTimeout(r, 4000))]).finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    void notifyBotLog('⚠️ Unhandled promise rejection', 0xe67e22, [
      { name: 'Reason', value: String(reason) },
    ]);
  });

  discord.login(discordToken);
} else {
  console.log('No Discord token found — running web server only.');
}
