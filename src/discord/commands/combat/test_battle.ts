import { ButtonStyle } from "discord.js";
import logger from "../../../utility/logger.js";

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder } from '@discordjs/builders';

const test_battle_embed: EmbedBuilder = new EmbedBuilder()
	.setColor(0x00FFFF)
	.setTitle('A rat has approached!')
	.setDescription('As you wake up in a large, grassy field, several objects lie around you.  A hissing sound turns your attention to your left.  A rat, standing on its hind legs, looks poised to attack you.  You have the chance to grab one item to fight back!')
	.addFields(
		{name: 'Shovel (Recommended)', value: 'A rusty shovel sits before you.  Seems like it\'s still sturdy!', inline: true},
		{name: 'Deck of Cards', value: 'A full deck of cards sits before you.  Could be sharp...', inline: true},
		{name: 'Can of Paint', value: 'A can of paint sits before you.  Could you ... paint the rat?', inline: true},
		{name: 'Awakened Mind', value: 'You see a pebble sitting in the grass before you.  For some reason you feel a kinship with it.', inline: true},
		{name: 'Path of Vines and Thorns', value: 'The foilage in the area seems to be calling to you, asking you to help it get rid of this intruder.', inline: true}
	)

const test_battle_action_row = new ActionRowBuilder()
	.addComponents(
		new ButtonBuilder()
			.setCustomId('TestBattleShovelSelect')
			.setLabel('Shovel')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('TestBattleCardsSelect')
			.setLabel('Deck Of Cards')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('TestBattlePaintSelect')
			.setLabel('Can of Paint')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('TestBattleBrainSelect')
			.setLabel('Awakened Mind')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId('TestBattleVineSelect')
			.setLabel('Path of Vines and Thorns')
			.setStyle(ButtonStyle.Primary),
	)

export default {
	data: new SlashCommandBuilder()
		.setName('testbattle')
		.setDescription('Battle against a rat!'),
	execute: async function(interaction: any) {
		logger.info("Running Test Battle Command");
		await interaction.reply(
			{
				embeds: [test_battle_embed],
				components: [test_battle_action_row]
			}
		);
	},
};