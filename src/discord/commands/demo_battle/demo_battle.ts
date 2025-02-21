import { ButtonStyle } from "discord.js";
import logger from "../../../utility/logger.js";

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder } from '@discordjs/builders';

import { weapon_select_embed, weapon_select_row } from "../../handlers/demo_handler.js";

const demo_battle_embed: EmbedBuilder = weapon_select_embed

const demo_battle_action_row = weapon_select_row

export default {
	data: new SlashCommandBuilder()
		.setName('demobattle')
		.setDescription('Battle against a rat!'),
	execute: async function(interaction: any) {
		logger.info("Running Demo Battle Command");
		await interaction.reply(
			{
				embeds: [demo_battle_embed],
				components: [demo_battle_action_row]
			}
		);
	},
};