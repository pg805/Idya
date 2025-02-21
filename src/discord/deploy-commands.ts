import logger from '../utility/logger.js';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
// import { clientId, guildId, token } from './config.json';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const commands = [];
// Grab all the command folders from the commands directory you created earlier
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    // Grab all the command files from the commands directory you created earlier
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((file: string) => file.endsWith('.js'));
    // Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
		logger.info(filePath)
        const command: {data: SlashCommandBuilder, execute:()=>{}, default: string} = (await import(`file:///${filePath}`)).default;

        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        } else {
            logger.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const token=JSON.parse(fs.readFileSync('./database/config.json','utf-8'))['TOKEN']

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
    try {
        logger.info(`Started refreshing ${commands.length} application (/) commands.`);

        // The put method is used to fully refresh all commands in the guild with the current set
        const data = await rest.put(
            // Routes.applicationGuildCommands('912129153216675851', '594244452437065729'),
            Routes.applicationGuildCommands('912129153216675851', '1083250123284418590'),
            { body: commands },
        );

        // @ts-ignore
        logger.info(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        // And of course, make sure you catch and log any errors!
        logger.error(error);
    }
})();
