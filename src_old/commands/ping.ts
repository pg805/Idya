import logger from "../util/logger";

const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Pong!'),
	execute: async function(interaction: any) {
		logger.info("Running Ping Command");
		await interaction.reply('Pong!');
	},
};