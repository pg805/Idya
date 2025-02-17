import logger from '../utility/logger.js';

// Require the necessary discord.js classes
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Collection, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, SlashCommandBuilder } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import Battle from '../combat/battle.js';
import Player_Character from '../character/player_character.js';
import Weapon from '../weapon/weapon.js';
import Block from '../weapon/action/block.js';
import Result_Field from '../infrastructure/result_field.js';
import Strike from '../weapon/action/strike.js';
import Pattern from '../infrastructure/pattern.js';
import Non_Player_Character from '../character/non_player_character.js';
import test_battle from './commands/test_battle/test_battle.js';
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const token=JSON.parse(fs.readFileSync('./database/config.json','utf-8'))['TOKEN']

// Create a new client instance
const client: Client<boolean> = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands: Collection<string, {
    execute: Function
}> = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command: {data: SlashCommandBuilder, execute:()=>{}, default: string} = (await import(`file:///${filePath}`)).default;
        // import command from filePath;
        // Set a new item in the Collection with the key as the command name and the value as the exported module
        if ('data' in command && 'execute' in command) {
            commands.set(command.data.name, command);
        } else {
            logger.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

/* Tidy Below */

/* Rat Weapon - Claws */
const rat_defend = 5;
const rat_block: Block = new Block('Block', '<User> prepares to block for 5 damage.', rat_defend);
const rat_attack: Result_Field = new Result_Field([0, 3, 5, 5, 7, 10]);
const rat_strike: Strike = new Strike('Strike', '<User> scratches <Target> dealing <Damage> damage.', rat_attack);
const rat_special: Result_Field = new Result_Field([3, 9, 15, 15]);
const rat_bite: Strike = new Strike('Bite', '<User> bites <Target> for <Damage> damage.', rat_special);
const rat_claws: Weapon = new Weapon('Claws', [rat_block], [], [rat_strike], [rat_block], [rat_bite], []);

const rat_pattern: Pattern = new Pattern([1, 2, 3]);
const rat: Non_Player_Character = new Non_Player_Character(
    'Rat',
    30,
    rat_pattern,
    rat_claws
);


let battle: Battle | null = null;
let human: Player_Character = new Player_Character(
    'Human',
    50,
    Weapon.from_json('./database/weapons/shovel.json')
);

/* Tidy Stop */

client.on(Events.InteractionCreate, async (interaction) => {
    // if (!interaction.isChatInputCommand()) return;

    if(interaction.isCommand()){

        const command = commands.get(interaction.commandName);
        
        if (!command) {
            logger.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }
        
        try {
            await command.execute(interaction);
        } catch (error) {
            logger.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
    }

    /* Tidy Start */

    if(interaction.isButton()) {
        const button = interaction.customId

        let start_battle = false;
        let start_weapon_string = '';
        let round_object:  {
            action_string: string,
            winner: string
        } = {
            action_string: '',
            winner: ''
        };

        switch(button) {
            case 'TestBattleShovelSelect':
                if(!battle) {
                    start_battle = true;
                    logger.info('Shovel Chosen as weapon!');
                    start_weapon_string = 'You pick up the shovel and feel the weight in your hands. Time to dig deep.';
                    human = new Player_Character(
                        'Human',
                        50,
                        Weapon.from_json('./database/weapons/shovel.json')
                    );
                } else {
                    logger.warn('Battle already started!')
                }
                break;
            case 'TestBattleCardsSelect':
                if(!battle) {
                    start_battle = true;
                    logger.info('Deck of Cards Chosen as weapon!');
                    start_weapon_string = 'You pick up the deck of cards and shuffle.  Time to draw.';
                    human = new Player_Character(
                        'Human',
                        50,
                        Weapon.from_json('./database/weapons/deck_of_cards.json')
                    );
                } else {
                    logger.warn('Battle already started!')
                }
                break;
            case 'TestBattlePaintSelect':
                if(!battle) {
                    start_battle = true;
                    logger.info('Paint Can Chosen as weapon!');
                    start_weapon_string = 'You pick up the can of paint and watch the colors swirl.';
                    human = new Player_Character(
                        'Human',
                        50,
                        Weapon.from_json('./database/weapons/can_of_paint.json')
                    );
                } else {
                    logger.warn('Battle already started!')
                }
                break;
            case 'TestBattleBrainSelect':
                if(!battle) {
                    start_battle = true;
                    logger.info('Awakened Mind Chosen as weapon!');
                    start_weapon_string = 'The pebble begins to levitate as you command it to.';
                    human = new Player_Character(
                        'Human',
                        50,
                        Weapon.from_json('./database/weapons/awakened_mind.json')
                    );
                } else {
                    logger.warn('Battle already started!')
                }
                break;
            case 'TestBattleVineSelect':
                if(!battle) {
                    start_battle = true;
                    logger.info('Vines and Thorns Chosen as weapon!');
                    start_weapon_string = 'The grass begins to sway with each of your breaths.';
                    human = new Player_Character(
                        'Human',
                        50,
                        Weapon.from_json('./database/weapons/vine_and_thorn.json')
                    );
                } else {
                    logger.warn('Battle already started!')
                }
                break;
            case 'TestBattleDefend':
                if(battle) {
                    round_object = battle.resolve_round(1)
                } else {
                    logger.warn('Battle not started!')
                }
                break;
            case 'TestBattleAttack':
                if(battle) {
                    round_object = battle.resolve_round(2)
                } else {
                    logger.warn('Battle not started!')
                }
                break;
            case 'TestBattleSpecial':
                if(battle) {
                    round_object = battle.resolve_round(3)
                } else {
                    logger.warn('Battle not started!')
                }
                break;
        }
        
        if(start_battle) {
            battle = new Battle(
                human,
                rat
            )
        }

        if(battle) {
            if(!round_object.winner) {
                const rat_action = battle.npc_index

                let rat_attack_saying = ''

                switch(rat_action) {
                    case 0:
                        rat_attack_saying = 'The rat is defending itself, giving you time to plan your next move carefully! (Recommended action - Special)'
                        break;
                    case 1: 
                        rat_attack_saying = 'The rat is getting ready for a quick scratch! (Recommended action - Defend)'
                        break;
                    case 2:
                        rat_attack_saying = 'The rat is winding up to attack, strike it first! (Recommended action - Attack)'
                    break;
                }


                const old_embed = interaction.message.embeds[0]
                const battle_embed = EmbedBuilder.from(old_embed)
                    .setTitle('Rat Battle')
                    .setDescription(`${start_weapon_string}${round_object.action_string}\n${rat_attack_saying}\nChoose your action!`)
                    .setFields({
                        name: "Player Character",
                        value: `${battle.pc_object.health}`,
                        inline: true
                        },{
                        name: "Rat",
                        value: `${battle.npc_object.health}`,
                        inline: true
                        },
                    )

                const battle_action_row: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
                    .setComponents(
                        new ButtonBuilder()
                            .setCustomId('TestBattleDefend')
                            .setLabel('Defend')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('TestBattleAttack')
                            .setLabel('Attack')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId('TestBattleSpecial')
                            .setLabel('Special')
                            .setStyle(ButtonStyle.Primary)
                    )
                
                await interaction.update({
                    embeds: [battle_embed],
                    components: [battle_action_row]
                })
            } else {

                const old_embed = interaction.message.embeds[0]
                const battle_embed = EmbedBuilder.from(old_embed)
                    .setTitle('Rat Battle')
                    .setDescription(`${battle.winner} has won!`)
                    .setFields({
                        name: "Player Character",
                        value: `${battle.pc_object.health}`,
                        inline: true
                        },{
                        name: "Rat",
                        value: `${battle.npc_object.health}`,
                        inline: true
                        },
                    )

                    const battle_action_row: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
                    .setComponents(
                        new ButtonBuilder()
                            .setCustomId('TestBattleDefend')
                            .setLabel('Defend')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('TestBattleAttack')
                            .setLabel('Attack')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('TestBattleSpecial')
                            .setLabel('Special')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true)
                    )
                
                await interaction.update({
                    embeds: [battle_embed],
                    components: [battle_action_row]
                })
            }
        }

    }

    /* Tidy Stop */
});

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(token);
