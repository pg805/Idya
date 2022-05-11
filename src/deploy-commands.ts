import logger from './util/logger.js';

const fs = require('node:fs');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
// const { clientId, guildId, token } = require('./config.json');
const TOKEN = JSON.parse(fs.readFileSync('./data/settings.json', 'utf-8')).DISCORDTOKEN;


const commands = [];
const command_files = fs.readdirSync('./src/commands').filter((file: any) => file.endsWith('.js'));

for (const file of command_files) {
	const command = require(`./src/commands/${file}`);
	commands.push(command.data.toJSON());
}

const rest = new REST({ version: '9' }).setToken(TOKEN);

// client id then guild id
rest.put(Routes.applicationGuildCommands(912129153216675851, 594244452437065729), { body: commands })
	.then(() => logger.info('Successfully registered application commands.'))
	.catch((e: Error) => logger.error(e));