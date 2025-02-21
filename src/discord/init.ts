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
import BattleManager from './battle_manager.js';
import demo_battle from './button_handlers/demo_handler.js';
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

const human_image = 'https://cdn.discordapp.com/attachments/1258456865881194586/1341942313601204244/Asterius_with_Background_-_Big.png?ex=67b7d4ab&is=67b6832b&hm=e0f2f414fbf23dcca89969b37b6477e96049df1b142ea32feea0316e3f73c270&'

/* Rat Weapon - Claws */
const enemy: Non_Player_Character = Non_Player_Character.from_file('./database/enemies/rat.json')

let human: Player_Character = new Player_Character(
    'Human',
    50,
    Weapon.from_file('./database/weapons/shovel.json'),
    human_image
);

const battle_manager = new BattleManager()

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
            case 'DemoBattleShovelSelect':
            case 'DemoBattleCardsSelect':
            case 'DemoBattlePaintSelect':
            case 'DemoBattleBrainSelect':
            case 'DemoBattleVineSelect':
            case 'DemoDenyWeapon':
            case 'DemoConfirmWeapon':
                // start_battle = true;
                // logger.info('Vines and Thorns Chosen as weapon!');
                // start_weapon_string = 'The grass begins to sway with each of your breaths.';
                // human = new Player_Character(
                //     'Human',
                //     50,
                //     Weapon.from_file('./database/weapons/vine_and_thorn.json'),
                //     human_image
                // );

                // battle_manager.button_start_battle(interaction, human, enemy, 'The rat is defending itself, giving you time to plan your next move carefully! (Recommended action - Special)')
                logger.info(`Sending Interaction to Demo Battle: ${button}`)
                demo_battle(interaction, battle_manager)
                break;
            case 'BattleDefend':
            case 'BattleAttack':
            case 'BattleSpecial':
                const rat_action: number = (battle_manager.find_battle(interaction.message.id).npc_index + 1) % 3
                let rat_attack_saying = '';
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

                logger.debug(`Rat Action in Init: ${rat_action}\n${rat_attack_saying}`)

                battle_manager.button_update_battle(interaction, rat_attack_saying)
                break;
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
