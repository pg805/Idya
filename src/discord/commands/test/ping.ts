import logger from "../../../utility/logger.js";

import { SlashCommandBuilder } from '@discordjs/builders';

export default {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Pong!'),
	execute: async function(interaction: any) {
		logger.info("Running Ping Command");
		await interaction.reply('Pong!');
	},
};