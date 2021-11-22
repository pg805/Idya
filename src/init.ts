'use strict';

// library dependencies
import logger from './util/logger.js';
import * as Discord from 'discord.js';

// exit message
process.on('exit', (code) => {
    logger.info(`About to exit with code: ${code}`);
});

// promise error
process.on('unhandledRejection', (error) => logger.error(`Uncaught Promise Rejection: ${error}`));

// exit
process.on('SIGTERM', () =>
    process.exit(0),
);

const client = new Discord.Client(
    { intents:
        [
            Discord.Intents.FLAGS.GUILDS,
            Discord.Intents.FLAGS.GUILD_MEMBERS,
            Discord.Intents.FLAGS.GUILD_MESSAGES,
            Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
            Discord.Intents.FLAGS.DIRECT_MESSAGES,
            Discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS
        ]
    }
);

// create custom startup option for logger?
client.once('ready', () => {
    logger.info(
        `Connected to Discord
        Logged in as: ${client.user ? client.user.username : ''} - (${client.user ? client.user.id : ''})
    `);
});

client.login('OTEyMTI5MTUzMjE2Njc1ODUx.YZrceA.A__cSsigtW_mKeQ9daNNn92xFMI');

client.destroy();
