import fs from 'fs';
import express, { type Request, type Response } from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  Client, GatewayIntentBits, Partials, Events,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  type GuildMember, type APIInteractionGuildMember,
} from 'discord.js';
import CharacterRepository from '../character/character_repository.js';
import { SPRITES } from '../character/sprites.js';
import prisma from '../database/prisma.js';
import { Prisma } from '@prisma/client';
import RewardService from '../economy/reward_service.js';
import type { LootTable } from '../economy/reward_service.js';
import worldConfig from '../discord/world_config.js';
import Weapon from '../weapon/weapon.js';
import { CombatSession, CombatantMeta, Combatant } from '../combat/combat_session.js';
import { CombatantState } from '../combat/combatant_state.js';
import { CombatIntent } from '../combat/intent.js';
import { buildWeaponInfo, loadEnemy } from '../combat/enemy_loader.js';
import { generateAIIntent } from '../combat/ai.js';
import { resolveIntents } from '../combat/resolution.js';
import { PatternActionType } from '../infrastructure/pattern.js';
import { SELF_TARGET_TYPES } from '../weapon/action.js';
import { chebyshevDist } from '../combat/board.js';
import { reachableTiles } from '../combat/movement.js';
import { loadShop } from '../economy/shop_loader.js';
import { getPrices, buyItem, sellItem } from '../economy/shop_service.js';
import { ITEMS } from '../economy/items.js';
import { loadAllRecipes, type RecipeOutput } from '../economy/recipe_loader.js';
import {
  budgetForLevel, upgradeCost, totalUpgradesUsed,
  upgradeKind, actionsWithCategories, buildFieldLenMap,
  allRawActions, weaponUpgradeProfessions, normalizePlayerUpgrades,
  summedFieldBonus, summedValueBonus, totalUpgradesOnWeapon, weaponUpgradeCap,
  canEnchant, enchantDelta,
  ENCHANT_SLOTS, ENCHANT_MINOR_COST, ENCHANT_MAJOR_COST,
  ENCHANT_CATEGORIES, ENCHANT_SUBTYPES, ENCHANT_DAMAGE_TYPE, ENCHANT_LEVEL_REQUIRED,
  type Profession, type RawWeapon, type RawAction, type WeaponEnchants, type EnchantKind, type EnchantCategory,
} from '../economy/upgrade_service.js';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const sessions = new Map<string, CombatSession>();
const sessionMeta = new Map<string, { discordUserId: string; isTutorial: boolean; lootTable: LootTable; enemyName: string; startedAt: Date; rounds: { turn: number; log: string[] }[] }>();
const charRepo = new CharacterRepository();
const pendingCharCreation = new Map<string, { name: string; nationality?: string; bio?: string }>();

interface AuthToken { discordUserId: string; }
const authTokens = new Map<string, AuthToken>(); // token → user
const userTokens = new Map<string, string>();    // discordUserId → token (reuse across visits)

// ---- Trade sessions ----

interface TradeOffer { itemId: string; quantity: number; }
interface TradePlayer { discordId: string; charName: string; offer: TradeOffer[]; locked: boolean; confirmed: boolean; }
interface TradeSession { tradeId: string; players: [TradePlayer, TradePlayer]; status: 'waiting' | 'active' | 'complete' | 'cancelled'; }

const tradeSessions = new Map<string, TradeSession>();

function tradeSessionView(session: TradeSession, viewerId: string) {
  return {
    tradeId: session.tradeId,
    status:  session.status,
    you:   session.players.find(p => p.discordId === viewerId),
    them:  session.players.find(p => p.discordId !== viewerId),
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

// ---- Telegraph ----

const TELEGRAPH: Record<string, Record<string, string>> = {
  defend:  { closing: 'Pulling back',       holding: 'Bracing',             retreating: 'Retreating' },
  attack:  { closing: 'Closing in',         holding: 'Poised to strike',    retreating: 'Breaking away' },
  special: { closing: 'Moving with intent', holding: 'Preparing something', retreating: 'Buying time' },
};

function computeTelegraph(meta: CombatantMeta, ai: Combatant, enemies: Combatant[]): string {
  if (meta.pattern.length === 0 || enemies.length === 0) return '';

  const entry = meta.pattern[meta.patternIndex];
  const { weapon } = meta;

  const category =
    entry.type === PatternActionType.Defend  ? 'defend'  :
    entry.type === PatternActionType.Attack  ? 'attack'  : 'special';

  let action = null;
  if (entry.type === PatternActionType.Defend)  action = weapon.defend[entry.index]  ?? null;
  if (entry.type === PatternActionType.Attack)  action = weapon.attack[entry.index]  ?? null;
  if (entry.type === PatternActionType.Special) action = weapon.special[entry.index] ?? null;

  if (!action || SELF_TARGET_TYPES.has(action.type)) {
    return TELEGRAPH[category].holding;
  }

  const nearest = enemies.reduce((a, b) =>
    chebyshevDist(ai.pos, a.pos) <= chebyshevDist(ai.pos, b.pos) ? a : b
  );
  const dist = chebyshevDist(ai.pos, nearest.pos);
  const movement = dist <= action.range ? 'holding' : 'closing';
  return TELEGRAPH[category][movement];
}

function refreshTelegraphs(session: CombatSession): void {
  session.telegraphs = {};
  for (const c of session.aiCombatants()) {
    const meta = session.meta.get(c.id);
    if (!meta) continue;
    const enemies = session.combatants.filter(e => e.teamId !== c.teamId);
    session.telegraphs[c.id] = computeTelegraph(meta, c, enemies);
  }
}

// ---- Session creation ----

const VALID_ENEMIES = ['lithkem_swallow', 'sulfolk', 'talwyrm', 'daefen_deer', 'maetoad'] as const;
type EnemyKey = typeof VALID_ENEMIES[number];

const BAIT_TO_ENEMY: Record<string, EnemyKey> = {
  swallow_bait: 'lithkem_swallow',
  sulfolk_bait: 'sulfolk',
  wyrm_bait:    'talwyrm',
  deer_bait:    'daefen_deer',
  toad_bait:    'maetoad',
};
const BAIT_ITEM_IDS = Object.keys(BAIT_TO_ENEMY);

function createSession(sessionId: string, enemyKey: EnemyKey | 'tutorial_swallow', playerSprite?: string, playerName = 'Hero', weaponKey = 'branch', isTutorial = false): { session: CombatSession; lootTable: LootTable; enemyName: string } {
  const weapon     = Weapon.from_file(join(__dirname, `../../database/weapons/${weaponKey}.yaml`));
  const fistsInfo = buildWeaponInfo(weapon);
  const playerHp  = weapon.hp;
  const playerState = new CombatantState(playerName, playerHp, weapon.resource_name, weapon.resource_max);

  const enemyFile = isTutorial ? 'tutorial_swallow' : enemyKey;
  const { combatant: enemy, meta: enemyMeta, lootTable } = loadEnemy(
    join(__dirname, `../../database/enemies/${enemyFile}.yaml`),
    { id: 'enemy-1', teamId: 'team-b', pos: isTutorial ? { x: 5, y: 0 } : { x: 6, y: 2 }, movementRange: 2 },
  );

  const boardConfig = isTutorial
    ? { width: 6, height: 2, obstacles: [] }
    : {
        width: 7,
        height: 5,
        obstacles: [
          { pos: { x: 2, y: 1 }, state: 'intact' as const },
          { pos: { x: 2, y: 2 }, state: 'intact' as const },
          { pos: { x: 2, y: 3 }, state: 'intact' as const },
          { pos: { x: 4, y: 1 }, state: 'intact' as const },
          { pos: { x: 4, y: 2 }, state: 'intact' as const },
          { pos: { x: 4, y: 3 }, state: 'intact' as const },
        ],
      };

  const playerStartPos = isTutorial ? { x: 0, y: 1 } : { x: 0, y: 2 };

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
          movementRange: 2,
          isAI: false,
          teamId: 'team-a',
          weaponInfo: fistsInfo,
          sprite: playerSprite,
        }],
      },
      {
        id: 'team-b',
        name: 'Enemy',
        combatants: [enemy],
      },
    ],
  );

  session.meta.set('player-1', { weapon: weapon, state: playerState, pattern: [], patternIndex: 0 });
  session.meta.set('enemy-1', enemyMeta);
  session.phase = 'intent';
  refreshTelegraphs(session);
  return { session, lootTable, enemyName: enemy.name };
}

// ---- Web server ----

app.use(express.static(join(__dirname, '../../public')));
app.use(express.json());

app.get('/battle/:sessionId', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../../public/index.html'));
});

app.get('/weapon-stats', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../../public/weapon-stats.html'));
});

app.get('/trade/:tradeId', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../../public/trade.html'));
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

function resolveAuth(req: Request): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return authTokens.get(header.slice(7))?.discordUserId ?? null;
}

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

  res.json({
    shopName: config.name,
    npc:      config.npc,
    title:    config.title,
    greeting: config.greeting,
    korel:    dbUser?.korel ?? 0,
    training,
    items: prices.map(p => ({
      id:          p.id,
      name:        ITEMS[p.id]?.name        ?? dbItems.find(i => i.id === p.id)?.name        ?? p.id,
      description: ITEMS[p.id]?.description ?? dbItems.find(i => i.id === p.id)?.description ?? '',
      buy:         p.buy  ?? null,
      sell:        p.sell ?? null,
      stock:       p.current_stock,
      stock_max:   p.stock_max,
    })),
    inventory: inventory.map(i => ({
      item_id:     i.item_id,
      name:        i.item.name,
      description: i.item.description,
      quantity:    i.quantity,
    })),
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
  if (!itemId || !Number.isInteger(quantity) || quantity < 1) {
    res.status(400).json({ error: 'Invalid request' }); return;
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
    void pingChannel(
      (worldConfig.channels as Record<string, string>)[shopKey],
      `<@${discordId}> bought **${quantity}× ${ITEMS[itemId]?.name ?? itemId}** from ${config.npc}.`,
    );
  }
});

app.post('/api/shop/:shopKey/sell', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const shopKey = String(req.params.shopKey);
  if (!validShop(shopKey)) { res.status(404).json({ error: 'Shop not found' }); return; }
  const { itemId, quantity } = req.body as { itemId: string; quantity: number };
  if (!itemId || !Number.isInteger(quantity) || quantity < 1) {
    res.status(400).json({ error: 'Invalid request' }); return;
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
    void pingChannel(
      (worldConfig.channels as Record<string, string>)[shopKey],
      `<@${discordId}> sold **${quantity}× ${ITEMS[itemId]?.name ?? itemId}** to ${config.npc}.`,
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
    void pingChannel(
      (worldConfig.channels as Record<string, string>)[shopKey],
      `<@${discordId}> sold their **${ITEMS[itemId]?.name ?? itemId}** to ${config.npc}.`,
    );
  }
});

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
    prisma.characterWeapon.findMany({ where: { character_id: chars[0].id }, select: { weapon_key: true } }),
  ]);
  const invMap: Record<string, number> = {};
  for (const inv of inventory) invMap[inv.item_id] = inv.quantity;
  const ownedWeaponKeys = new Set(ownedWeapons.map(w => w.weapon_key));

  const ingredientMet = (i: { item_id?: string; weapon_id?: string; quantity: number }): boolean => {
    if (i.weapon_id) return ownedWeaponKeys.has(i.weapon_id) && i.weapon_id !== chars[0].weapon_key;
    return (invMap[i.item_id ?? ''] ?? 0) >= i.quantity;
  };

  const allRecipes = loadAllRecipes(RECIPES_DIR);
  const recipes = allRecipes.map(r => ({
    ...r,
    levelMet:       (profLevels[r.profession] ?? 0) >= r.required_level,
    ingredientsMet: r.ingredients.every(ingredientMet),
    available:      (profLevels[r.profession] ?? 0) >= r.required_level && r.ingredients.every(ingredientMet),
    ingredients: r.ingredients.map(i => ({
      ...i,
      name: i.item_id ? (ITEMS[i.item_id]?.name ?? i.item_id) : (i.weapon_id ?? ''),
    })),
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
  if (recipe.output.type === 'enchant') {
    res.status(400).json({ error: 'Enchant recipes are applied via /api/enchant, not /api/craft.' }); return;
  }

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
        if (chars[0].weapon_key === ing.weapon_id) {
          return { success: false, message: `Unequip your ${ing.weapon_id} before using it in a recipe.` };
        }
        const wep = await tx.characterWeapon.findUnique({
          where: { character_id_weapon_key: { character_id: chars[0].id, weapon_key: ing.weapon_id } },
        });
        if (!wep) return { success: false, message: `Requires a ${ing.weapon_id}.` };
        await tx.characterWeapon.delete({
          where: { character_id_weapon_key: { character_id: chars[0].id, weapon_key: ing.weapon_id } },
        });
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
      const rawWeapon   = recipe.output.base_bonus ? loadWeaponYaml(outputId, __dirname) : null;
      const baseUpgrades = rawWeapon && recipe.output.base_bonus
        ? computeBaseUpgrades(rawWeapon, recipe.output.base_bonus)
        : {};
      const hasBase = Object.keys(baseUpgrades).length > 0;

      const existingWeapon = await tx.characterWeapon.findUnique({
        where: { character_id_weapon_key: { character_id: chars[0].id, weapon_key: outputId } },
      });

      if (existingWeapon) {
        if (hasBase) {
          const prev = (existingWeapon.upgrades ?? {}) as { base?: Record<string, unknown>; player?: Record<string, unknown> };
          await tx.characterWeapon.update({
            where: { character_id_weapon_key: { character_id: chars[0].id, weapon_key: outputId } },
            data:  { upgrades: { ...prev, base: { ...(prev.base ?? {}), ...baseUpgrades } } as Prisma.InputJsonValue },
          });
        }
      } else {
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
    const pingMsg = qty > 1
      ? `<@${discordId}> crafted **${qty}× ${recipe.name}**!`
      : `<@${discordId}> crafted a **${recipe.name}**!`;
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

  const weaponRows = await prisma.characterWeapon.findMany({ where: { character_id: char.id } });

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
    const upgrades     = (row.upgrades ?? {}) as { base?: Record<string, unknown>; player?: unknown };
    const baseDeltas   = (upgrades.base ?? {}) as Record<string, number | number[]>;
    const playerUpgrades  = normalizePlayerUpgrades(upgrades.player, professions[0]);
    const fieldLens       = buildFieldLenMap(raw);
    const weaponTotal     = totalUpgradesOnWeapon(playerUpgrades, professions, fieldLens);
    const profBudgets     = professions.map(p => budgetForLevel(profLevelOf(p)));
    const weaponCap       = weaponUpgradeCap(profBudgets);
    const weaponAtCap     = weaponTotal >= weaponCap;

    const professionInfo = professions.map((prof, i) => {
      const profDeltas = playerUpgrades[prof] ?? {};
      const profUsed = totalUpgradesUsed(profDeltas, fieldLens);
      const budget   = profBudgets[i];
      const atCap    = profUsed >= budget || weaponAtCap;
      return { profession: prof, used: profUsed, budget, at_cap: atCap, next_cost: atCap ? null : upgradeCost(weaponTotal + 1, prof) };
    });

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
      weapon_key: row.weapon_key,
      name: raw.Name,
      equipped: row.weapon_key === char.weapon_key,
      weapon_total: weaponTotal,
      weapon_cap: weaponCap,
      upgrade_professions: professionInfo,
      actions,
    });
  }

  res.json({ characterName: char.name, lj_level: profLevelOf('lumberjack'), weapons });
});

app.post('/api/upgrade/:weaponKey', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const weaponKey = String(req.params['weaponKey']);
  const { action, delta, profession: requestedProfession } = req.body as {
    action: string; delta: number | number[]; profession?: string;
  };

  const raw = loadWeaponYaml(weaponKey, __dirname);
  if (!raw) { res.status(404).json({ error: 'Weapon not found' }); return; }

  const validProfessions = weaponUpgradeProfessions(weaponKey);
  const profession = (requestedProfession ?? validProfessions[0]) as Profession;
  if (!validProfessions.includes(profession)) {
    res.json({ success: false, message: `${profession} cannot upgrade this weapon.` });
    return;
  }

  const rawAction = allRawActions(raw).find(a => a.Name === action);
  if (!rawAction) { res.json({ success: false, message: 'Action not found.' }); return; }

  const kind = upgradeKind(rawAction);
  if (!kind) { res.json({ success: false, message: 'This action cannot be upgraded.' }); return; }

  if (kind === 'field') {
    if (!Array.isArray(delta)) { res.json({ success: false, message: 'Expected array delta for field action.' }); return; }
    const len = rawAction.Field!.length;
    if (delta.length !== len) { res.json({ success: false, message: `Delta must have ${len} entries.` }); return; }
    if (!delta.every(v => Number.isInteger(v) && v >= 0)) { res.json({ success: false, message: 'Delta values must be non-negative integers.' }); return; }
    if (delta.reduce((a, b) => a + b, 0) !== len) { res.json({ success: false, message: `Field delta must sum to ${len}.` }); return; }
  } else {
    if (delta !== 1) { res.json({ success: false, message: 'Value delta must be 1.' }); return; }
  }

  const fieldLens = buildFieldLenMap(raw);

  const result = await prisma.$transaction(async tx => {
    const weaponRow = await tx.characterWeapon.findUnique({
      where: { character_id_weapon_key: { character_id: char.id, weapon_key: String(weaponKey) } },
    });
    if (!weaponRow) return { success: false, message: 'You do not own this weapon.' };

    const profRows = await tx.characterProfession.findMany({
      where: { character_id: char.id, profession: { in: validProfessions } },
    });
    const profLevelOf = (p: Profession) => profRows.find(r => r.profession === p)?.level ?? 0;
    const budget     = budgetForLevel(profLevelOf(profession));
    const weaponCap  = weaponUpgradeCap(validProfessions.map(p => budgetForLevel(profLevelOf(p))));

    const upgrades       = (weaponRow.upgrades ?? {}) as { base?: Record<string, unknown>; player?: unknown };
    const playerUpgrades = normalizePlayerUpgrades(upgrades.player, validProfessions[0]);
    const profDeltas: Record<string, number | number[]> = { ...(playerUpgrades[profession] ?? {}) };
    const profUsed    = totalUpgradesUsed(profDeltas, fieldLens);
    const weaponTotal = totalUpgradesOnWeapon(playerUpgrades, validProfessions, fieldLens);

    if (profUsed >= budget) {
      return { success: false, message: `Upgrade budget full (${profUsed}/${budget}). Level up ${profession} to unlock more.` };
    }
    if (weaponTotal >= weaponCap) {
      return { success: false, message: `This weapon is at its upgrade cap (${weaponTotal}/${weaponCap}).` };
    }

    const cost = upgradeCost(weaponTotal + 1, profession);
    const invRow = await tx.inventoryItem.findUnique({
      where: { character_id_item_id: { character_id: char.id, item_id: cost.material } },
    });
    if ((invRow?.quantity ?? 0) < cost.quantity) {
      return { success: false, message: `Need ${cost.quantity} ${cost.material} (have ${invRow?.quantity ?? 0}).` };
    }

    if (invRow!.quantity === cost.quantity) {
      await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: char.id, item_id: cost.material } } });
    } else {
      await tx.inventoryItem.update({
        where: { character_id_item_id: { character_id: char.id, item_id: cost.material } },
        data: { quantity: { decrement: cost.quantity } },
      });
    }

    if (kind === 'field') {
      const existing = (profDeltas[action] as number[] | undefined) ?? rawAction.Field!.map(() => 0);
      profDeltas[action] = existing.map((v, i) => v + (delta as number[])[i]);
    } else {
      profDeltas[action] = ((profDeltas[action] as number | undefined) ?? 0) + 1;
    }

    const updatedPlayer = { ...playerUpgrades, [profession]: profDeltas };
    await tx.characterWeapon.update({
      where: { character_id_weapon_key: { character_id: char.id, weapon_key: String(weaponKey) } },
      data: { upgrades: { base: upgrades.base ?? {}, player: updatedPlayer } as Prisma.InputJsonValue },
    });

    await tx.eventLog.create({ data: {
      discord_id: discordId, event_type: 'weapon_upgraded',
      payload: { weapon_key: weaponKey, action, profession } as unknown as Prisma.InputJsonValue,
    }}).catch(() => {});

    return { success: true, message: `Upgraded ${action} via ${profession}.` };
  });

  res.json(result);
  if (result.success) {
    void pingChannel(
      PROFESSION_CHANNEL[profession],
      `<@${discordId}> upgraded **${raw.Name}** — ${action}!`,
    );
  }
});

// ---- Enchant endpoint ----

app.post('/api/enchant/:weaponKey', async (req: Request, res: Response) => {
  const discordId = resolveAuth(req);
  if (!discordId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const chars = await charRepo.list(discordId);
  if (chars.length === 0) { res.status(400).json({ error: 'No character found' }); return; }
  const char = chars[0];

  const weaponKey = String(req.params['weaponKey']);
  const { action: actionName, kind, category, subtype, delta } = req.body as {
    action: string; kind: string; category: string; subtype: string; delta: number | number[];
  };

  if (kind !== 'minor' && kind !== 'major') {
    res.status(400).json({ error: "kind must be 'minor' or 'major'" }); return;
  }
  if (!ENCHANT_CATEGORIES.includes(category as EnchantCategory)) {
    res.status(400).json({ error: `category must be one of: ${ENCHANT_CATEGORIES.join(', ')}` }); return;
  }
  const enchantKind = kind as EnchantKind;
  const enchantCategory = category as EnchantCategory;

  if (!ENCHANT_SUBTYPES[enchantCategory].includes(subtype)) {
    res.json({ success: false, message: `Invalid subtype '${subtype}' for ${enchantCategory} enchant. Valid: ${ENCHANT_SUBTYPES[enchantCategory].join(', ')}.` }); return;
  }

  const raw = loadWeaponYaml(weaponKey, __dirname);
  if (!raw) { res.status(404).json({ error: 'Weapon not found' }); return; }

  const action = allRawActions(raw).find(a => a.Name === actionName);
  if (!action) { res.json({ success: false, message: 'Action not found on this weapon.' }); return; }

  const uk = upgradeKind(action);
  if (!uk) { res.json({ success: false, message: 'This action cannot be enchanted.' }); return; }

  const expected = enchantDelta(enchantKind);
  if (uk === 'field') {
    if (!Array.isArray(delta) || delta.length !== (action.Field?.length ?? 0)) {
      res.json({ success: false, message: 'Delta must be an array matching action field length.' }); return;
    }
    if ((delta as number[]).reduce((a, b) => a + b, 0) !== expected) {
      res.json({ success: false, message: `Delta must sum to ${expected} for a ${enchantKind} enchant.` }); return;
    }
  } else {
    if (delta !== expected) {
      res.json({ success: false, message: `Delta must be ${expected} for a ${enchantKind} enchant.` }); return;
    }
  }

  // Check enchanter level for this category + kind
  const encProfRow = await prisma.characterProfession.findUnique({
    where: { character_id_profession: { character_id: char.id, profession: 'enchanter' } },
  });
  const encLvl = encProfRow?.level ?? 0;
  const requiredLvl = ENCHANT_LEVEL_REQUIRED[enchantCategory][enchantKind];
  if (encLvl < requiredLvl) {
    res.json({ success: false, message: `Requires Enchanter level ${requiredLvl} for ${enchantCategory} ${enchantKind} enchants.` }); return;
  }

  const cost = enchantKind === 'minor' ? ENCHANT_MINOR_COST : ENCHANT_MAJOR_COST;

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

    const weaponRow = await tx.characterWeapon.findUnique({
      where: { character_id_weapon_key: { character_id: char.id, weapon_key: weaponKey } },
    });
    if (!weaponRow) return { success: false, message: 'You do not own this weapon.' };

    const upgrades = (weaponRow.upgrades ?? {}) as {
      base?: Record<string, unknown>;
      player?: Record<string, unknown>;
      enchants?: WeaponEnchants;
    };
    const enchants: WeaponEnchants = upgrades.enchants ?? {};

    const check = canEnchant(enchants, actionName);
    if (!check.ok) return { success: false, message: check.reason };

    const newEnchant = {
      kind:     enchantKind,
      category: enchantCategory,
      subtype,
      ...(enchantKind === 'major' ? { type: ENCHANT_DAMAGE_TYPE[enchantCategory] } : {}),
      delta,
    };

    await tx.characterWeapon.update({
      where: { character_id_weapon_key: { character_id: char.id, weapon_key: weaponKey } },
      data: {
        upgrades: {
          ...upgrades,
          enchants: { ...enchants, [actionName]: newEnchant },
        } as Prisma.InputJsonValue,
      },
    });

    await tx.eventLog.create({ data: {
      discord_id: discordId,
      event_type: 'weapon_enchanted',
      payload: { weapon_key: weaponKey, action: actionName, kind: enchantKind, category: enchantCategory, subtype },
    }}).catch(() => {});

    return { success: true, message: `${actionName} enchanted with ${enchantCategory} (${subtype}).` };
  });

  res.json(result);
});

sessions.set('test', createSession('test', 'lithkem_swallow').session);

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
    if (isTut) {
      socket.emit('tutorial_aside', { text: 'The lithkem swallow nests near lakes and rivers.  It uses water as a tool and weapon and is able to spit a blast hard enough to cut wood.  Be careful on your approach.' });
      socket.emit('tutorial_aside', { text: 'Click your character first, then select a highlighted tile to move, or select the tile you are on to stay put.', isOOC: true });
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
        session.combatants.filter(c => c.id !== combatant.id).map(c => `${c.pos.x},${c.pos.y}`)
      );
      const reachable = reachableTiles(combatant.pos, combatant.movementRange, session.board, occupied);
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
    const result = resolveIntents(session, session.pendingIntents);
    refreshTelegraphs(session);

    io.to(sessionId).emit('session_state', session.toState());
    io.to(sessionId).emit('turn_result', { log: result.log });

    const tutMeta = sessionMeta.get(sessionId);
    if (tutMeta) tutMeta.rounds.push({ turn: session.turn, log: result.log });
    if (tutMeta?.isTutorial && !result.winner) {
      const TUTORIAL_ASIDES: Record<number, { text: string; ooc?: string }> = {
        1: {
          text: 'Swallows are also fast and hard to hit.  Be patient and watch its movements to hit where it will be.',
          ooc: 'You will have a selection of actions and each action will either be a Defend, Attack, or Special action.  While an enemy has its guard up, wind up a harder hitting Special action to do the most damage!  Some actions require you to aim — click a highlighted tile to choose your target before submitting.  The enemy\'s card will show a hint as to which action they are planning next.',
        },
        2: {
          text: "It's winding up to peck you, put your guard up.",
          ooc: 'Defend actions beat Attack actions — blocking reduces damage when the enemy strikes.',
        },
        3: {
          text: "Looks like it's going to try to slow you down with it's water.  Hit it first!",
          ooc: 'Attack actions beat Special actions.  Attack actions also have a special property if used against Special actions: if you hit an enemy while they are winding up, you will land a critical hit giving either more damage or additional effects.  Reactive Attack actions will automatically target the nearest enemy without needing to aim.',
        },
        4: {
          text: "Alright, seems like you got the hang of it.  I'll be downstairs if you need me.",
        },
      };
      const aside = TUTORIAL_ASIDES[session.turn];
      if (aside) {
        io.to(sessionId).emit('tutorial_aside', { text: aside.text });
        if (aside.ooc) io.to(sessionId).emit('tutorial_aside', { text: aside.ooc, isOOC: true });
      }

      if (session.turn >= 10) {
        io.to(sessionId).emit('tutorial_aside', { text: "Still working?  Let me help." });
        io.to(sessionId).emit('tutorial_aside', { text: "Fendalok draws a gleaming metalic sword and swings it at the bird, cutting off it's head.", isOOC: true });
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
        await prisma.user.update({
          where: { discord_id: tutMeta.discordUserId },
          data: { tutorial_complete: true },
        }).catch(() => {});
        io.to(sessionId).emit('reward_result', { summary: 'Tutorial complete.' });
        io.to(sessionId).emit('tutorial_aside', { text: "Good job, seems you will be a good fit around here." });
        io.to(sessionId).emit('tutorial_aside', { text: "Let me give you a few tips before you go out in the forest.  First, watch for patterns, the same kinds of creatures tend to do the same things and that's useful for knowing which action to do." });
        io.to(sessionId).emit('tutorial_aside', { text: "Reactive actions are usually lower power, but not needing to aim makes them more consistent." });
        io.to(sessionId).emit('tutorial_aside', { text: "Finally, when you hit, you aren't always hitting the best spot so the amount of damage you will do will vary each time you do an action, but usually if you are affecting yourself you will be able to be consistent.  Thanks again for the help and let me know if you need anything else." });
      }
    }

    if (result.winner) {
      io.to(sessionId).emit('game_over', { winner: result.winner });
      const meta = sessionMeta.get(sessionId);

      if (meta && result.winner === 'team-a') {
        const chars = await charRepo.list(meta.discordUserId);
        const char = chars[0];
        let rewardSummary = 'No drops.';
        let korelEarned = 0;
        if (char) {
          const rewards = await new RewardService().grant(meta.discordUserId, char.id, meta.lootTable, meta.enemyName).catch(() => null);
          rewardSummary = rewards?.summary ?? 'No drops.';
          korelEarned = rewards?.currency ?? 0;
          const winLog = await prisma.battleLog.create({ data: {
            discord_id: meta.discordUserId, character_id: char.id,
            enemy: meta.enemyName, outcome: 'win',
            korel_delta: korelEarned, loot: rewardSummary,
            started_at: meta.startedAt,
          }}).catch(() => null);
          if (winLog && meta.rounds.length > 0) {
            await prisma.battleRoundLog.create({ data: { battle_id: winLog.id, rounds: meta.rounds as unknown as Prisma.InputJsonValue } }).catch(() => {});
          }
        }
        if (meta.isTutorial) {
          await prisma.user.update({
            where: { discord_id: meta.discordUserId },
            data: { tutorial_complete: true },
          }).catch(() => {});
        }
        io.to(sessionId).emit('reward_result', { summary: `Loot: ${rewardSummary}` });
        if (meta.isTutorial) {
          io.to(sessionId).emit('tutorial_aside', { text: "Good job, seems you will be a good fit around here." });
        io.to(sessionId).emit('tutorial_aside', { text: "Let me give you a few tips before you go out in the forest.  First, watch for patterns, the same kinds of creatures tend to do the same things and that's useful for knowing which action to do." });
        io.to(sessionId).emit('tutorial_aside', { text: "Reactive actions are usually lower power, but not needing to aim makes them more consistent." });
        io.to(sessionId).emit('tutorial_aside', { text: "Finally, when you hit, you aren't always hitting the best spot so the amount of damage you will do will vary each time you do an action, but usually if you are affecting yourself you will be able to be consistent.  Thanks again for the help and let me know if you need anything else." });
        }
        if (discord) {
          try {
            const ch = await discord.channels.fetch(worldConfig.channels.forest);
            if (ch?.isTextBased() && 'send' in ch) {
              const msg = rewardSummary !== 'No drops.'
                ? `<@${meta.discordUserId}> returns from the forest!\n${rewardSummary}`
                : `<@${meta.discordUserId}> returns from the forest. The ${meta.enemyName.toLowerCase()} didn't have anything interesting.`;
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
          const lossLog = await prisma.battleLog.create({ data: {
            discord_id: meta.discordUserId, character_id: char.id,
            enemy: meta.enemyName, outcome: 'loss',
            korel_delta: -fee, started_at: meta.startedAt,
          }}).catch(() => null);
          if (lossLog && meta.rounds.length > 0) {
            await prisma.battleRoundLog.create({ data: { battle_id: lossLog.id, rounds: meta.rounds as unknown as Prisma.InputJsonValue } }).catch(() => {});
          }
        }
        const feeMsg = fee > 0 ? `Healing fee: −${fee} Korel` : 'No healing fee.';
        io.to(sessionId).emit('reward_result', { summary: feeMsg });
        if (discord) {
          try {
            const ch = await discord.channels.fetch(worldConfig.channels.forest);
            if (ch?.isTextBased() && 'send' in ch) {
              const msg = fee > 0
                ? `<@${meta.discordUserId}> was defeated by the ${meta.enemyName.toLowerCase()} and paid ${fee} Korel in healing fees.`
                : `<@${meta.discordUserId}> was defeated by the ${meta.enemyName.toLowerCase()} and returned empty-handed.`;
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
    const playerSprite = session.combatants.find(c => !c.isAI)?.sprite;
    if (oldMeta) {
      const chars = await charRepo.list(oldMeta.discordUserId).catch(() => []);
      if (chars[0]) { playerName = chars[0].name; playerWeaponKey = chars[0].weapon_key; }
    }

    const { session: fresh, lootTable, enemyName } = createSession(sessionId, enemyKey, playerSprite, playerName, playerWeaponKey);
    sessions.set(sessionId, fresh);
    if (oldMeta) {
      sessionMeta.set(sessionId, { ...oldMeta, lootTable, enemyName, startedAt: new Date(), rounds: [] });
    }
    io.to(sessionId).emit('session_joined', { playerTeamId: 'team-a', isTutorial: oldMeta?.isTutorial ?? false });
    io.to(sessionId).emit('session_state', fresh.toState());
  });

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id);
  });

  // ---- Trade Socket.io ----

  socket.on('join_trade', async ({ tradeId, auth }: { tradeId: string; auth: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = authTokens.get(auth)?.discordUserId;
    if (!session || !discordId || !session.players.find(p => p.discordId === discordId)) return;
    socket.join(`trade-${tradeId}`);
    if (session.status === 'waiting' && session.players.every(p =>
      io.sockets.adapter.rooms.get(`trade-${tradeId}`)?.size ?? 0 >= 1
    )) session.status = 'active';
    io.to(`trade-${tradeId}`).emit('trade_state', session);
  });

  socket.on('trade_offer', ({ tradeId, auth, offer }: { tradeId: string; auth: string; offer: TradeOffer[] }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = authTokens.get(auth)?.discordUserId;
    const player = session?.players.find(p => p.discordId === discordId);
    if (!player || player.locked) return;
    player.offer = offer.filter(o => o.quantity > 0);
    io.to(`trade-${tradeId}`).emit('trade_state', session);
  });

  socket.on('trade_lock', ({ tradeId, auth }: { tradeId: string; auth: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = authTokens.get(auth)?.discordUserId;
    const player = session?.players.find(p => p.discordId === discordId);
    if (!player) return;
    player.locked = !player.locked;
    if (!player.locked) player.confirmed = false;
    io.to(`trade-${tradeId}`).emit('trade_state', session);
  });

  socket.on('trade_confirm', async ({ tradeId, auth }: { tradeId: string; auth: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = authTokens.get(auth)?.discordUserId;
    const player = session?.players.find(p => p.discordId === discordId);
    if (!player || !player.locked) return;
    player.confirmed = true;
    io.to(`trade-${tradeId}`).emit('trade_state', session);

    if (session!.players.every(p => p.confirmed)) {
      session!.status = 'complete';
      const [a, b] = session!.players;
      try {
        await prisma.$transaction(async tx => {
          for (const { itemId, quantity } of a.offer) {
            const charA = (await charRepo.list(a.discordId))[0];
            const charB = (await charRepo.list(b.discordId))[0];
            if (!charA || !charB) throw new Error('Character not found');
            const invA = await tx.inventoryItem.findUnique({ where: { character_id_item_id: { character_id: charA.id, item_id: itemId } } });
            if (!invA || invA.quantity < quantity) throw new Error(`${a.charName} doesn't have enough ${itemId}`);
            await tx.inventoryItem.update({ where: { character_id_item_id: { character_id: charA.id, item_id: itemId } }, data: { quantity: { decrement: quantity } } });
            await tx.inventoryItem.upsert({ where: { character_id_item_id: { character_id: charB.id, item_id: itemId } }, update: { quantity: { increment: quantity } }, create: { character_id: charB.id, item_id: itemId, quantity } });
          }
          for (const { itemId, quantity } of b.offer) {
            const charA = (await charRepo.list(a.discordId))[0];
            const charB = (await charRepo.list(b.discordId))[0];
            if (!charA || !charB) throw new Error('Character not found');
            const invB = await tx.inventoryItem.findUnique({ where: { character_id_item_id: { character_id: charB.id, item_id: itemId } } });
            if (!invB || invB.quantity < quantity) throw new Error(`${b.charName} doesn't have enough ${itemId}`);
            await tx.inventoryItem.update({ where: { character_id_item_id: { character_id: charB.id, item_id: itemId } }, data: { quantity: { decrement: quantity } } });
            await tx.inventoryItem.upsert({ where: { character_id_item_id: { character_id: charA.id, item_id: itemId } }, update: { quantity: { increment: quantity } }, create: { character_id: charA.id, item_id: itemId, quantity } });
          }
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

  socket.on('trade_cancel', ({ tradeId, auth }: { tradeId: string; auth: string }) => {
    const session = tradeSessions.get(tradeId);
    const discordId = authTokens.get(auth)?.discordUserId;
    if (!session || !session.players.find(p => p.discordId === discordId)) return;
    session.status = 'cancelled';
    io.to(`trade-${tradeId}`).emit('trade_state', session);
    setTimeout(() => tradeSessions.delete(tradeId), 60_000);
  });
});

const PORT = process.env.PORT ?? 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Test session: http://localhost:${PORT}/battle/test`);
});

// ---- Discord bot ----

function isAdmin(member: GuildMember | APIInteractionGuildMember): boolean {
  return 'cache' in member.roles
    ? member.roles.cache.has(worldConfig.admin_role)
    : (member.roles as string[]).includes(worldConfig.admin_role);
}

function isDev(userId: string): boolean {
  return worldConfig.dev.includes(userId);
}

function buildWelcomeEmbed(mention: string): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const mayor = worldConfig.npcs.mayor;
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setAuthor({ name: `${mayor.name} — ${mayor.title}` })
        .setDescription(
          `${mention}\n\n` +
          `The journey has been long and rough.  Tales of prosperity spreading throughout the Chae empire sustained you through the cold nights sleeping on the ground, hoping for a better life.  Hard to believe at first, small towns reportedly have found new sources of wealth from their local wildlife.  With much of the rest of the empire, including you, recovering from an economic depression, many have decided to journey to the frontier to make a new life.  A local merchant caravan agreed to let you join for the remains of your savings and with little choice, you joined.\n\n` +
          `The caravan stops in a clearing on the outskirts of your final destination, Sulku'it.  A tall man with a gruff chinstrap beard wearing rugged overalls approaches your caravan.  After dealing with the caravan leader, he turns to you.\n\n` +
          `**${mayor.name}** — *${mayor.title}*\n` +
          `*"Ah, another traveler, welcome to Sulku'it. My name is Fendalok and I'm the Padev around here. I take it you are here to help out in the forest. The empire* asks *that we record everyone in the town census log for tax purposes."*\n\n*Fendalok sneers at the mention of taxes. He turns inquisitive as he looks you up and down.*\n\n*"You've got good timing, a bird got into the attic again and I could use some help getting rid of it. Could you grab that branch and help me out? You can keep whatever it leaves behind."*`
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('CreateChar_Begin')
          .setLabel('Register in the Census Log')
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

const DEFAULT_SPRITE_KEYS = ['asterius', 'penni-cold', 'trenton', 'thokk'];

function buildSpritePicker(): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const options = SPRITES.filter(s => DEFAULT_SPRITE_KEYS.includes(s.key));
  return {
    embeds: options.map(s =>
      new EmbedBuilder()
        .setColor(0x1a1a2e)
        .setTitle(s.name)
        .setImage(`${worldConfig.sprite_cdn}/${s.key}.png`)
    ),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        options.map(s =>
          new ButtonBuilder().setCustomId(`PickSprite_${s.key}`).setLabel(s.name).setStyle(ButtonStyle.Primary)
        )
      ),
    ],
  };
}

function buildNationalitySelect(): { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[]; flags: typeof MessageFlags.Ephemeral } {
  const select = new StringSelectMenuBuilder()
    .setCustomId('NationalitySelect')
    .setPlaceholder('Select your nationality...')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Chae').setValue('Chae').setDescription('Empire citizen'),
      new StringSelectMenuOptionBuilder().setLabel('Ketulvu').setValue('Ketulvu').setDescription('Frontier local'),
    );
  return {
    content: 'What nationality are you?',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  };
}

function buildCharModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId('CreateCharModal').setTitle('Create Your Character');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('CreateCharNameInput')
        .setLabel('Character Name')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(32)
        .setPlaceholder("Enter your character's name...")
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('CreateCharBioInput')
        .setLabel('About Your Character')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(300)
        .setPlaceholder('Anything else you want others to know...')
        .setRequired(false)
    )
  );
  return modal;
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

  discord.on(Events.InteractionCreate, async (interaction) => {
    // ---- Hunt ----

    if (interaction.isChatInputCommand() && interaction.commandName === 'hunt') {
      if (interaction.channelId !== worldConfig.channels.forest) {
        await interaction.reply({ content: "You can only hunt in the forest.", flags: MessageFlags.Ephemeral });
        return;
      }

      const chars = await charRepo.list(interaction.user.id);
      if (chars.length === 0) {
        await interaction.reply({ content: "You don't have a character yet. Use the button in welcome to get started.", flags: MessageFlags.Ephemeral });
        return;
      }

      const dbUser = await prisma.user.findUnique({ where: { discord_id: interaction.user.id } });
      if (!dbUser?.tutorial_complete) {
        await interaction.reply({ content: "Talk to Fendalok first — use `/battle` to start the tutorial.", flags: MessageFlags.Ephemeral });
        return;
      }

      const baitRows = await prisma.inventoryItem.findMany({
        where: { character_id: chars[0].id, item_id: { in: BAIT_ITEM_IDS } },
      });
      const availableBait = baitRows.filter(r => r.quantity > 0);

      if (availableBait.length === 0) {
        await interaction.reply({ content: "You don't have any bait. Visit the General Store to pick some up.", flags: MessageFlags.Ephemeral });
        return;
      }

      const baitButtons = availableBait.map(r =>
        new ButtonBuilder()
          .setCustomId(`Hunt_${r.item_id}`)
          .setLabel(`${ITEMS[r.item_id]?.name ?? r.item_id} (${r.quantity})`)
          .setStyle(ButtonStyle.Primary)
      );

      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < baitButtons.length; i += 5) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(baitButtons.slice(i, i + 5)));
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x1a1a2e)
            .setTitle('Sulkupa Forest')
            .setDescription('The trees are dense this far out. Choose your bait and head in.'),
        ],
        components: rows,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('Hunt_')) {
      const baitId = interaction.customId.replace('Hunt_', '');
      const enemyKey = BAIT_TO_ENEMY[baitId];
      if (!enemyKey) return;

      const chars = await charRepo.list(interaction.user.id);
      if (chars.length === 0) return;
      const char = chars[0];

      const consumed = await prisma.$transaction(async tx => {
        const inv = await tx.inventoryItem.findUnique({
          where: { character_id_item_id: { character_id: char.id, item_id: baitId } },
        });
        if (!inv || inv.quantity < 1) return false;
        if (inv.quantity === 1) {
          await tx.inventoryItem.delete({ where: { character_id_item_id: { character_id: char.id, item_id: baitId } } });
        } else {
          await tx.inventoryItem.update({
            where: { character_id_item_id: { character_id: char.id, item_id: baitId } },
            data: { quantity: { decrement: 1 } },
          });
        }
        return true;
      });

      if (!consumed) {
        await interaction.update({ content: "You don't have that bait anymore.", embeds: [], components: [] });
        return;
      }

      const playerSprite = char.sprite_token ? `${HOST}/sprites/${char.sprite_token}.png` : undefined;
      const sessionId = Math.random().toString(36).slice(2, 10);
      const { session: huntSession, lootTable, enemyName } = createSession(sessionId, enemyKey, playerSprite, char.name, char.weapon_key);
      sessions.set(sessionId, huntSession);
      sessionMeta.set(sessionId, { discordUserId: interaction.user.id, isTutorial: false, lootTable, enemyName, startedAt: new Date(), rounds: [] });

      await interaction.update({
        content: `**Into the forest!**\n${HOST}/battle/${sessionId}`,
        embeds: [],
        components: [],
      });
      return;
    }

    // ---- Character creation ----

    if (interaction.isChatInputCommand() && interaction.commandName === 'createcharacter') {
      const existing = await charRepo.list(interaction.user.id);
      if (existing.length > 0) {
        await interaction.reply({ content: 'You already have a character! Use `/profile` to view it.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(buildCharModal());
      return;
    }

    if (interaction.isButton() && interaction.customId === 'CreateChar_Begin') {
      const existing = await charRepo.list(interaction.user.id);
      if (existing.length > 0) {
        await interaction.reply({ content: 'You already have a character! Use `/profile` to view it.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.showModal(buildCharModal());
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'CreateCharModal') {
      const name = interaction.fields.getTextInputValue('CreateCharNameInput');
      const bio  = interaction.fields.getTextInputValue('CreateCharBioInput').trim() || undefined;
      pendingCharCreation.set(interaction.user.id, { name, bio });
      await interaction.reply(buildNationalitySelect());
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'NationalitySelect') {
      const pending = pendingCharCreation.get(interaction.user.id);
      if (!pending) {
        await interaction.update({ content: 'Session expired. Run /createcharacter again.', components: [] });
        return;
      }
      pending.nationality = interaction.values[0];
      await interaction.update({
        ...buildSpritePicker(),
        content: `Welcome to Sulku'it, **${pending.name}**! Choose a sprite to represent you in battle.`,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('PickSprite_')) {
      const spriteKey = interaction.customId.replace('PickSprite_', '');
      const pending = pendingCharCreation.get(interaction.user.id);
      if (!pending) {
        await interaction.update({ content: 'Session expired. Run /createcharacter again.', embeds: [], components: [] });
        return;
      }
      pendingCharCreation.delete(interaction.user.id);
      const sprite = SPRITES.find(s => s.key === spriteKey);
      const character = await charRepo.create(interaction.user.id, pending.name, 'branch', spriteKey, pending.nationality, pending.bio);
      const playerSprite = `${HOST}/sprites/${spriteKey}.png`;
      const sessionId = Math.random().toString(36).slice(2, 10);
      const { session: charSession, lootTable, enemyName } = createSession(sessionId, 'lithkem_swallow', playerSprite, 'Hero', 'branch', true);
      sessions.set(sessionId, charSession);
      sessionMeta.set(sessionId, { discordUserId: interaction.user.id, isTutorial: true, lootTable, enemyName, startedAt: new Date(), rounds: [] });
      await interaction.update({
        content: '',
        embeds: [
          new EmbedBuilder()
            .setColor(0x00cc66)
            .setTitle('Character Created!')
            .setDescription(`**${character.name}** has arrived in Sulku'it!\n\nFendalok has a bird problem. Follow him upstairs and help him take care of it.`)
            .setThumbnail(playerSprite)
            .addFields(
              { name: 'HP',     value: `${character.max_health}`, inline: true },
              { name: 'Weapon', value: 'Branch',                  inline: true },
              { name: 'Sprite', value: sprite?.name ?? spriteKey, inline: true },
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setLabel('Follow Fendalok')
              .setURL(`${HOST}/battle/${sessionId}`)
              .setStyle(ButtonStyle.Link)
          ),
        ],
      });
      return;
    }
  });

  // ---- Admin commands ----

  discord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'admin') return;
    if (!interaction.member || !isAdmin(interaction.member)) {
      await interaction.reply({ content: 'Unauthorized.', flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'joinsim') {
      const target = interaction.options.getUser('user', true);
      await interaction.reply({ ...buildWelcomeEmbed(`<@${target.id}>`), flags: MessageFlags.Ephemeral });
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
      await prisma.characterWeapon.upsert({
        where:  { character_id_weapon_key: { character_id: chars[0].id, weapon_key: weaponKey } },
        update: {},
        create: { character_id: chars[0].id, weapon_key: weaponKey },
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
      const quantity = interaction.options.getInteger('quantity') ?? 1;
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
      await prisma.item.upsert({
        where:  { id: itemId },
        update: {},
        create: { id: itemId, name: itemDef.name, description: itemDef.description },
      });
      await prisma.inventoryItem.upsert({
        where:  { character_id_item_id: { character_id: chars[0].id, item_id: itemId } },
        update: { quantity: { increment: quantity } },
        create: { character_id: chars[0].id, item_id: itemId, quantity },
      });
      await interaction.reply({ content: `Gave ${quantity}× **${itemDef.name}** to ${target.username}.`, flags: MessageFlags.Ephemeral });
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

  discord.on(Events.InteractionCreate, async (interaction) => {
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

  discord.on(Events.InteractionCreate, async (interaction) => {
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
    const ownedWeapons = await prisma.characterWeapon.findMany({ where: { character_id: char.id } });
    const weaponsText = ownedWeapons.length > 0
      ? ownedWeapons.map(cw => {
          const w = Weapon.from_file(join(__dirname, `../../database/weapons/${cw.weapon_key}.yaml`));
          return cw.weapon_key === char.weapon_key ? `**${w.name}** (equipped)` : w.name;
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

  discord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'weapon') return;

    const chars = await charRepo.list(interaction.user.id);
    if (chars.length === 0) {
      await interaction.reply({ content: "You don't have a character yet!", flags: MessageFlags.Ephemeral });
      return;
    }
    const char = chars[0];
    const ownedWeapons = await prisma.characterWeapon.findMany({ where: { character_id: char.id } });
    if (ownedWeapons.length === 0) {
      await interaction.reply({ content: 'You have no weapons in your inventory.', flags: MessageFlags.Ephemeral });
      return;
    }

    const options = ownedWeapons.map(cw => {
      const w = Weapon.from_file(join(__dirname, `../../database/weapons/${cw.weapon_key}.yaml`));
      return new StringSelectMenuOptionBuilder()
        .setLabel(w.name)
        .setDescription(w.description || cw.weapon_key)
        .setValue(cw.weapon_key)
        .setDefault(cw.weapon_key === char.weapon_key);
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId('WeaponEquip')
      .setPlaceholder('Choose a weapon to equip')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    await interaction.reply({ content: 'Choose a weapon to equip:', components: [row], flags: MessageFlags.Ephemeral });
  });

  discord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'WeaponEquip') return;

    const chars = await charRepo.list(interaction.user.id);
    if (chars.length === 0) { await interaction.update({ content: 'No character found.', components: [] }); return; }
    const char = chars[0];

    const weaponKey = interaction.values[0];
    const owned = await prisma.characterWeapon.findUnique({
      where: { character_id_weapon_key: { character_id: char.id, weapon_key: weaponKey } },
    });
    if (!owned) { await interaction.update({ content: "You don't own that weapon.", components: [] }); return; }

    await prisma.character.update({ where: { id: char.id }, data: { weapon_key: weaponKey } });
    const w = Weapon.from_file(join(__dirname, `../../database/weapons/${weaponKey}.yaml`));
    await prisma.eventLog.create({ data: {
      discord_id: interaction.user.id, event_type: 'weapon_equipped',
      payload: { weapon_key: weaponKey, weapon_name: w.name },
    }}).catch(() => {});
    await interaction.update({ content: `**${w.name}** equipped.`, components: [] });
  });

  // ---- Shop ----

  const CHANNEL_TO_SHOP: Record<string, string> = {
    [worldConfig.channels.blacksmith]:      'blacksmith',
    [worldConfig.channels.general_store]:   'general_store',
    [worldConfig.channels.lumberjack]:      'lumberjack',
    [worldConfig.channels.temple]:          'temple',
    [worldConfig.channels.enchanting_shop]: 'enchanting_shop',
  };

  discord.on(Events.InteractionCreate, async (interaction) => {
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
      content: `**${config.name}**\n${HOST}/shop/${shopKey}?auth=${token}`,
      flags: MessageFlags.Ephemeral,
    });
  });

  // ---- Craft ----

  discord.on(Events.InteractionCreate, async (interaction) => {
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
      content: `${HOST}/craft?auth=${token}`,
      flags: MessageFlags.Ephemeral,
    });
  });

  // ---- Trade ----

  discord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'trade') return;

    const target = interaction.options.getUser('user', true);
    if (target.id === interaction.user.id) {
      await interaction.reply({ content: "You can't trade with yourself.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (target.bot) {
      await interaction.reply({ content: "You can't trade with a bot.", flags: MessageFlags.Ephemeral });
      return;
    }

    const initiatorChars = await charRepo.list(interaction.user.id);
    const targetChars    = await charRepo.list(target.id);
    if (initiatorChars.length === 0) {
      await interaction.reply({ content: "You don't have a character yet.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (targetChars.length === 0) {
      await interaction.reply({ content: `${target.username} doesn't have a character yet.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const tradeId   = Math.random().toString(36).slice(2, 9);
    const tokenA    = getOrCreateToken(interaction.user.id);
    const tokenB    = getOrCreateToken(target.id);

    const session: TradeSession = {
      tradeId,
      status: 'waiting',
      players: [
        { discordId: interaction.user.id, charName: initiatorChars[0].name, offer: [], locked: false, confirmed: false },
        { discordId: target.id,           charName: targetChars[0].name,    offer: [], locked: false, confirmed: false },
      ],
    };
    tradeSessions.set(tradeId, session);
    setTimeout(() => tradeSessions.delete(tradeId), 10 * 60_000);

    await interaction.reply({
      content: `**Trade with ${target.username}**\n${HOST}/trade/${tradeId}?auth=${tokenA}`,
      flags: MessageFlags.Ephemeral,
    });

    try {
      await target.send(`**${interaction.user.username}** wants to trade with you!\n${HOST}/trade/${tradeId}?auth=${tokenB}`);
    } catch (_) {
      await interaction.followUp({
        content: `Could not DM ${target.username} — they may have DMs disabled. Share this link with them: ${HOST}/trade/${tradeId}?auth=${tokenB}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  });

  // ---- Weapons reference ----

  discord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'weapon-stats') return;
    await interaction.reply({ content: `${HOST}/weapon-stats`, flags: MessageFlags.Ephemeral });
  });

  // ---- Ping ----

  discord.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ping') return;
    await interaction.reply('Pong!');
  });

  // ---- Guild member join ----

  discord.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id !== worldConfig.guild_id) return;
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
