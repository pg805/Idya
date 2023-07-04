'use strict';

// library dependencies
import logger from './util/logger.js';
import * as Discord from 'discord.js';
import * as fs from 'fs';
import { time } from 'console';
import './combat_old/test_battle.js';
import { battle_action, start_battle } from './combat_old/test_battle.js';
import { initializeState } from './_store/state.js';
import { handleButtonPress } from './discord/handleButtonPress.js';

// exit message
process.on('exit', (code) => {
    if(client.isReady()) {
        client.destroy();
    }
    logger.info(`About to exit with code: ${code}`);
});

// promise error
process.on('unhandledRejection', (error) => logger.error(`Uncaught Promise Rejection: ${error}`));

// exit
process.on('SIGTERM', () =>{
    process.exit(0)
});

const client = new Discord.Client(
    { intents:
        [
            Discord.Intents.FLAGS.GUILDS,
            Discord.Intents.FLAGS.GUILD_MESSAGES,
            Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
            Discord.Intents.FLAGS.DIRECT_MESSAGES,
            Discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS
        ]
    }
);

initializeState();

const check_path = './lib/commands';

// @ts-ignore: Adding new collection to client
client.commands = new Discord.Collection();
const command_files = fs.readdirSync(check_path).filter((file: any) => file.endsWith('.js'));

for (const file of command_files) {
    const command = require(`./commands/${file}`);
    // Set a new item in the Collection
    // With the key as the command name and the value as the exported module

    logger.info(`Adding command ${command.data.name} to the command list!`);
    // @ts-ignore: Adding commands to client
    client.commands.set(command.data.name, command);
}

// create custom startup option for logger?
client.once('ready', () => {
    logger.info("Connected to Discord");
    logger.info('Logged in as:');
    logger.info(`${client.user ? client.user.username : ''} - (${client.user ? client.user.id : ''})`);
});

// Handle Interactions
client.on('interactionCreate', async interaction => {
    // Handle Commands
	if (interaction.isCommand()) {
        logger.debug(`
Handling Command
Command Name: ${interaction.commandName}
Command ID: ${interaction.commandId}
Guild ID: ${interaction.guildId}
Channel ID: ${interaction.channelId}
`)

        // @ts-ignore: accessing commands
        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            logger.error(error);
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    } else if (interaction.isButton()) {
        // Handle Button Press in ./discord/handleButtonPress.js
        handleButtonPress(interaction);
    }
    return;
});

client
    .login(JSON.parse(fs.readFileSync('./data/settings.json', 'utf-8')).DISCORDTOKEN);
