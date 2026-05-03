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
  type User, type GuildMember, type APIInteractionGuildMember,
} from 'discord.js';
import CharacterRepository from '../character/character_repository.js';
import { SPRITES } from '../character/sprites.js';
import prisma from '../database/prisma.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const sessions = new Map<string, CombatSession>();
const sessionMeta = new Map<string, { discordUserId: string; isTutorial: boolean }>();
const charRepo = new CharacterRepository();
const pendingCharNames = new Map<string, string>(); // discord_id → name

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

function createSession(sessionId: string, enemyKey: EnemyKey): CombatSession {
  const shovel     = Weapon.from_file(join(__dirname, '../../database/weapons/shovel.yaml'));
  const shovelInfo = buildWeaponInfo(shovel);
  const playerHp   = 50;
  const playerState = new CombatantState('Hero', playerHp, shovel.resource_name, shovel.resource_max);

  const { combatant: enemy, meta: enemyMeta } = loadEnemy(
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
          name: 'Hero',
          hp: playerHp,
          maxHp: playerHp,
          resource: shovel.resource_max,
          maxResource: shovel.resource_max,
          resourceName: shovel.resource_name,
          pos: { x: 0, y: 2 },
          movementRange: 2,
          isAI: false,
          teamId: 'team-a',
          weaponInfo: shovelInfo,
        }],
      },
      {
        id: 'team-b',
        name: 'Enemy',
        combatants: [enemy],
      },
    ],
  );

  session.meta.set('player-1', { weapon: shovel, state: playerState, pattern: [], patternIndex: 0 });
  session.meta.set('enemy-1', enemyMeta);
  session.phase = 'intent';
  refreshTelegraphs(session);
  return session;
}

// ---- Web server ----

app.use(express.static(join(__dirname, '../../public')));
app.get('/battle/:sessionId', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, '../../public/index.html'));
});

sessions.set('test', createSession('test', 'rat'));

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
    socket.emit('session_joined', { playerTeamId: 'team-a' });
    socket.emit('session_state', session.toState());
  });

  socket.on('submit_intent', async ({ sessionId, intent }: { sessionId: string; intent: CombatIntent }) => {
    const session = sessions.get(sessionId);
    if (!session || session.phase !== 'intent') return;

    const combatant = session.combatants.find(c => c.id === intent.combatantId);
    if (!combatant || combatant.isAI) return;

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
      if (meta?.isTutorial && result.winner === 'team-a') {
        await prisma.user.update({
          where: { discord_id: meta.discordUserId },
          data: { tutorial_complete: true },
        }).catch(() => {});
      }
    }
  });

  socket.on('reset_session', (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessionMeta.delete(sessionId);
    const enemyKey = (VALID_ENEMIES.find(k =>
      session.combatants.some(c => c.isAI && c.name.toLowerCase().includes(k))
    ) ?? 'rat') as EnemyKey;
    const fresh = createSession(sessionId, enemyKey);
    sessions.set(sessionId, fresh);
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

async function sendWelcomeDM(user: User): Promise<void> {
  const mayor = worldConfig.npcs.mayor;
  try {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x1a1a2e)
          .setAuthor({ name: `${mayor.name} — ${mayor.title}` })
          .setDescription(
            `"Ah, a new face in Sulku'it. The forest has a way of drawing wanderers in — few arrive here by accident.\n\n` +
            `I won't keep you long. The town is yours to explore: the general store is well stocked, the temple keeps its doors open, and the forest... well, the forest is what it is. Respect it and it'll let you pass.\n\n` +
            `If you mean to stay, introduce yourself properly. We keep a ledger of those who pass through these parts."`
          )
          .setFooter({ text: 'Use /createcharacter to register your name in the ledger of Sulku\'it.' }),
      ],
    });
  } catch {
    // DMs disabled — nothing we can do
  }
}

const HOST = process.env.HOST_URL ?? `http://localhost:${PORT}`;

let discordToken: string | null = null;
try {
  discordToken = JSON.parse(
    fs.readFileSync(join(__dirname, '../../database/config.json'), 'utf-8')
  )['TOKEN'] ?? null;
} catch (_) {}

if (discordToken) {
  const discord = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
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

      const dbUser = await prisma.user.findUnique({ where: { discord_id: interaction.user.id } });
      if (!dbUser?.tutorial_complete) {
        const sessionId = Math.random().toString(36).slice(2, 10);
        sessions.set(sessionId, createSession(sessionId, 'rat'));
        sessionMeta.set(sessionId, { discordUserId: interaction.user.id, isTutorial: true });
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

      const sessionId = Math.random().toString(36).slice(2, 10);
      sessions.set(sessionId, createSession(sessionId, enemyKey));
      sessionMeta.set(sessionId, { discordUserId: interaction.user.id, isTutorial: false });

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
        await interaction.reply({
          content: 'You already have a character! Use `/profile` to view it.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('CreateCharModal')
        .setTitle('Create Your Character');

      const nameInput = new TextInputBuilder()
        .setCustomId('CreateCharNameInput')
        .setLabel('Character Name')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(32)
        .setPlaceholder("Enter your character's name...")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'CreateCharModal') {
      const name = interaction.fields.getTextInputValue('CreateCharNameInput');
      pendingCharNames.set(interaction.user.id, name);

      const menu = new StringSelectMenuBuilder()
        .setCustomId('CreateCharSpriteSelect')
        .setPlaceholder('Choose your character sprite...')
        .addOptions(SPRITES.map(s =>
          new StringSelectMenuOptionBuilder().setLabel(s.name).setValue(s.key)
        ));

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x1a1a2e)
            .setTitle(`Welcome to Sulku'it, ${name}!`)
            .setDescription('Choose a sprite to represent your character in battle.'),
        ],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'CreateCharSpriteSelect') {
      const spriteKey = interaction.values[0];
      const name = pendingCharNames.get(interaction.user.id);
      if (!name) {
        await interaction.update({ content: 'Session expired. Run /createcharacter again.', embeds: [], components: [] });
        return;
      }
      pendingCharNames.delete(interaction.user.id);

      const sprite = SPRITES.find(s => s.key === spriteKey);
      const character = await charRepo.create(interaction.user.id, name, 'fists', spriteKey);

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00cc66)
            .setTitle('Character Created!')
            .setDescription(
              `**${character.name}** has arrived in Sulku'it!\n\n` +
              `A tutorial battle awaits — use \`/battle\` to begin your adventure.`
            )
            .setThumbnail(`${HOST}/sprites/${spriteKey}.png`)
            .addFields(
              { name: 'HP',     value: `${character.max_health}`, inline: true },
              { name: 'Weapon', value: 'Fists',                   inline: true },
              { name: 'Sprite', value: sprite?.name ?? spriteKey, inline: true },
            ),
        ],
        components: [],
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
      await sendWelcomeDM(target);
      await interaction.reply({ content: `Join flow sent to ${target.username}.`, flags: MessageFlags.Ephemeral });
    }
  });

  // ---- Guild member join ----

  discord.on(Events.GuildMemberAdd, async (member) => {
    if (member.guild.id !== worldConfig.guild_id) return;
    await sendWelcomeDM(member.user);
  });

  discord.once(Events.ClientReady, (c) => {
    console.log(`Discord bot ready: ${c.user.tag}`);
  });

  discord.login(discordToken);
} else {
  console.log('No Discord token found — running web server only.');
}
