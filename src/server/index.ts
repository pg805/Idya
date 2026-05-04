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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const sessions = new Map<string, CombatSession>();
const sessionMeta = new Map<string, { discordUserId: string; isTutorial: boolean; lootTable: LootTable; enemyName: string }>();
const charRepo = new CharacterRepository();
const pendingCharCreation = new Map<string, { name: string }>();

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

const VALID_ENEMIES = ['rat', 'zombie', 'mushroom'] as const;
type EnemyKey = typeof VALID_ENEMIES[number];

function createSession(sessionId: string, enemyKey: EnemyKey, playerSprite?: string, playerName = 'Hero', weaponKey = 'branch'): { session: CombatSession; lootTable: LootTable; enemyName: string } {
  const weapon     = Weapon.from_file(join(__dirname, `../../database/weapons/${weaponKey}.yaml`));
  const fistsInfo = buildWeaponInfo(weapon);
  const playerHp  = 50;
  const playerState = new CombatantState(playerName, playerHp, weapon.resource_name, weapon.resource_max);

  const { combatant: enemy, meta: enemyMeta, lootTable } = loadEnemy(
    join(__dirname, `../../database/enemies/${enemyKey}.yaml`),
    { id: 'enemy-1', teamId: 'team-b', pos: { x: 6, y: 2 }, movementRange: 2 },
  );

  const session = new CombatSession(
    sessionId,
    {
      width: 7,
      height: 5,
      obstacles: [
        { pos: { x: 2, y: 1 }, state: 'intact' },
        { pos: { x: 2, y: 2 }, state: 'intact' },
        { pos: { x: 2, y: 3 }, state: 'intact' },
        { pos: { x: 4, y: 1 }, state: 'intact' },
        { pos: { x: 4, y: 2 }, state: 'intact' },
        { pos: { x: 4, y: 3 }, state: 'intact' },
      ],
    },
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
          pos: { x: 0, y: 2 },
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
app.get('/battle/:sessionId', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../../public/index.html'));
});

sessions.set('test', createSession('test', 'rat').session);

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
    socket.emit('session_joined', { playerTeamId: 'team-a', isTutorial: sessionMeta.get(sessionId)?.isTutorial ?? false });
    socket.emit('session_state', session.toState());
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
    const result = resolveIntents(session, session.pendingIntents);
    refreshTelegraphs(session);

    io.to(sessionId).emit('session_state', session.toState());
    io.to(sessionId).emit('turn_result', { log: result.log });

    if (result.winner) {
      io.to(sessionId).emit('game_over', { winner: result.winner });
      const meta = sessionMeta.get(sessionId);

      if (meta && result.winner === 'team-a') {
        const chars = await charRepo.list(meta.discordUserId);
        const char = chars[0];
        let rewardSummary = 'No drops.';
        if (char) {
          const rewards = await new RewardService().grant(meta.discordUserId, char.id, meta.lootTable).catch(() => null);
          rewardSummary = rewards?.summary ?? 'No drops.';
        }
        if (meta.isTutorial) {
          await prisma.user.update({
            where: { discord_id: meta.discordUserId },
            data: { tutorial_complete: true },
          }).catch(() => {});
        }
        io.to(sessionId).emit('reward_result', { summary: `Loot: ${rewardSummary}` });
        if (discord) {
          try {
            const ch = await discord.channels.fetch(worldConfig.channels.forest);
            if (ch?.isTextBased() && 'send' in ch) {
              const msg = rewardSummary !== 'No drops.'
                ? `<@${meta.discordUserId}> returns from the forest!\n${rewardSummary}`
                : `<@${meta.discordUserId}> returns from the forest. The ${meta.enemyName.toLowerCase()} didn't have anything interesting.`;
              await (ch as import('discord.js').TextChannel).send(msg);
            }
          } catch (_) {}
        }
      }

      if (meta && result.winner === 'team-b') {
        const dbUser = await prisma.user.findUnique({ where: { discord_id: meta.discordUserId } }).catch(() => null);
        const currentKorel = dbUser?.korel ?? 0;
        const fee = Math.floor(currentKorel * 0.1);
        if (fee > 0) {
          await prisma.user.update({
            where: { discord_id: meta.discordUserId },
            data: { korel: { decrement: fee } },
          }).catch(() => {});
        }
        const feeMsg = fee > 0 ? `Mending fee: −${fee} Korel` : 'No mending fee.';
        io.to(sessionId).emit('reward_result', { summary: feeMsg });
        if (discord) {
          try {
            const ch = await discord.channels.fetch(worldConfig.channels.forest);
            if (ch?.isTextBased() && 'send' in ch) {
              const msg = fee > 0
                ? `<@${meta.discordUserId}> was defeated by the ${meta.enemyName.toLowerCase()} and paid ${fee} Korel in mending fees.`
                : `<@${meta.discordUserId}> was defeated by the ${meta.enemyName.toLowerCase()} and returned empty-handed.`;
              await (ch as import('discord.js').TextChannel).send(msg);
            }
          } catch (_) {}
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
    ) ?? 'rat') as EnemyKey;

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
      sessionMeta.set(sessionId, { ...oldMeta, lootTable, enemyName });
    }
    io.to(sessionId).emit('session_joined', { playerTeamId: 'team-a', isTutorial: oldMeta?.isTutorial ?? false });
    io.to(sessionId).emit('session_state', fresh.toState());
  });

  socket.on('disconnect', () => {
    console.log('client disconnected:', socket.id);
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
          `${mention} — "Ah, a new face in Sulku'it. The forest has a way of drawing wanderers in — few arrive here by accident.\n\n` +
          `The town is yours to explore: the general store is well stocked, the temple keeps its doors open, and the forest... well, the forest is what it is. Respect it and it'll let you pass.\n\n` +
          `If you mean to stay, introduce yourself properly. We keep a ledger of those who pass through these parts."`
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('CreateChar_Begin')
          .setLabel('Register in the Ledger')
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

const DEFAULT_SPRITE_KEYS = ['asterius', 'penni', 'dazzle', 'thokk'];

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
    )
  );
  return modal;
}

const HOST = process.env.HOST_URL ?? `http://localhost:${PORT}`;

let discord: import('discord.js').Client | null = null;
let discordToken: string | null = null;
try {
  discordToken = JSON.parse(
    fs.readFileSync(join(__dirname, '../../database/config.json'), 'utf-8')
  )['TOKEN'] ?? null;
} catch (_) {}

if (discordToken) {
  discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
    ],
  });

  const enemySelectEmbed = new EmbedBuilder()
    .setColor(0x1a1a2e)
    .setTitle('Choose Your Enemy')
    .setDescription('Select a monster to fight.')
    .addFields(
      { name: 'Rat',      value: 'Quick and aggressive. Good starting fight.',         inline: true },
      { name: 'Zombie',   value: 'Slow but hard-hitting. Weak to Sharp damage.',       inline: true },
      { name: 'Mushroom', value: 'Resilient. Resists Physical and Poison.',            inline: true },
    );

  const enemySelectRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('SpatialBattle_rat').setLabel('Rat').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('SpatialBattle_zombie').setLabel('Zombie').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('SpatialBattle_mushroom').setLabel('Mushroom').setStyle(ButtonStyle.Primary),
  );

  discord.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'battle') {
      const chars = await charRepo.list(interaction.user.id);
      if (chars.length === 0) {
        await interaction.reply({
          content: "You don't have a character yet! Use `/createcharacter` to begin your adventure in Sulku'it.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const playerSprite = chars[0]?.sprite_token ? `${HOST}/sprites/${chars[0].sprite_token}.png` : undefined;
      const dbUser = await prisma.user.findUnique({ where: { discord_id: interaction.user.id } });
      if (!dbUser?.tutorial_complete) {
        const sessionId = Math.random().toString(36).slice(2, 10);
        const { session: tutSession, lootTable, enemyName } = createSession(sessionId, 'rat', playerSprite, chars[0].name, chars[0].weapon_key);
        sessions.set(sessionId, tutSession);
        sessionMeta.set(sessionId, { discordUserId: interaction.user.id, isTutorial: true, lootTable, enemyName });
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x1a1a2e)
              .setTitle('Tutorial Battle')
              .setDescription(
                "Welcome to Sulku'it! Your first battle awaits.\n\n" +
                'Defeat the rat to complete your tutorial and unlock full battle selection.'
              ),
          ],
          content: `${HOST}/battle/${sessionId}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        embeds: [enemySelectEmbed],
        components: [enemySelectRow],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('SpatialBattle_')) {
      const enemyKey = interaction.customId.replace('SpatialBattle_', '') as EnemyKey;
      if (!VALID_ENEMIES.includes(enemyKey)) return;

      const chars = await charRepo.list(interaction.user.id);
      const playerSprite = chars[0]?.sprite_token ? `${HOST}/sprites/${chars[0].sprite_token}.png` : undefined;
      const sessionId = Math.random().toString(36).slice(2, 10);
      const { session: newSession, lootTable, enemyName } = createSession(sessionId, enemyKey, playerSprite, chars[0]?.name ?? 'Hero', chars[0]?.weapon_key ?? 'branch');
      sessions.set(sessionId, newSession);
      sessionMeta.set(sessionId, { discordUserId: interaction.user.id, isTutorial: false, lootTable, enemyName });

      await interaction.update({
        content: `**Battle ready!**\n${HOST}/battle/${sessionId}`,
        embeds: [],
        components: [],
      });
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
      pendingCharCreation.set(interaction.user.id, { name });
      await interaction.reply({
        ...buildSpritePicker(),
        content: `Welcome to Sulku'it, **${name}**! Choose a sprite to represent you in battle.`,
        flags: MessageFlags.Ephemeral,
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
      const character = await charRepo.create(interaction.user.id, pending.name, 'branch', spriteKey);
      const playerSprite = `${HOST}/sprites/${spriteKey}.png`;
      const sessionId = Math.random().toString(36).slice(2, 10);
      const { session: charSession, lootTable, enemyName } = createSession(sessionId, 'rat', playerSprite);
      sessions.set(sessionId, charSession);
      sessionMeta.set(sessionId, { discordUserId: interaction.user.id, isTutorial: true, lootTable, enemyName });
      await interaction.update({
        content: '',
        embeds: [
          new EmbedBuilder()
            .setColor(0x00cc66)
            .setTitle('Character Created!')
            .setDescription(`**${character.name}** has arrived in Sulku'it!\n\nYour first battle awaits in the forest.`)
            .setThumbnail(playerSprite)
            .addFields(
              { name: 'HP',     value: `${character.max_health}`, inline: true },
              { name: 'Weapon', value: 'Fists',                   inline: true },
              { name: 'Sprite', value: sprite?.name ?? spriteKey, inline: true },
            ),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setLabel('Enter the Forest')
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
      await interaction.reply({ content: `Added **${w.name}** to ${target.username}'s weapon inventory. They can equip it with \`/weapon\`.`, flags: MessageFlags.Ephemeral });
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
      const chars = await prisma.character.findMany({ where: { discord_id: target.id }, select: { id: true } });
      await prisma.inventoryItem.deleteMany({ where: { character_id: { in: chars.map(c => c.id) } } });
      await prisma.characterWeapon.deleteMany({ where: { character_id: { in: chars.map(c => c.id) } } });
      await prisma.character.deleteMany({ where: { discord_id: target.id } });
      await prisma.user.update({ where: { discord_id: target.id }, data: { tutorial_complete: false, korel: 0 } }).catch(() => {});
      await interaction.reply({ content: `Character reset for ${target.username}.`, flags: MessageFlags.Ephemeral });
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

    const embed = new EmbedBuilder()
      .setColor(0x1a1a2e)
      .setTitle(char.name)
      .addFields(
        { name: 'HP',        value: `${char.health} / ${char.max_health}`, inline: true },
        { name: 'Korel',     value: `${dbUser?.korel ?? 0}`,              inline: true },
        { name: '​',    value: '​',                              inline: true },
        { name: 'Weapons',   value: weaponsText,                           inline: false },
        { name: 'Inventory', value: invText,                               inline: false },
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
    await interaction.update({ content: `**${w.name}** equipped.`, components: [] });
  });

  // ---- Guild member join ----

  discord.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id !== worldConfig.guild_id) return;
    const channel = member.guild.channels.cache.get(worldConfig.channels.town_square);
    if (!channel?.isTextBased()) return;
    await channel.send(buildWelcomeEmbed(`<@${member.id}>`));
  });

  discord.once(Events.ClientReady, (c) => {
    console.log(`Discord bot ready: ${c.user.tag}`);
  });

  discord.login(discordToken);
} else {
  console.log('No Discord token found — running web server only.');
}
