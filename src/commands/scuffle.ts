import { MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import logger from "../util/logger";

const { SlashCommandBuilder } = require('@discordjs/builders');

const battle_embed: MessageEmbed = new MessageEmbed()
    .setColor('#00FFFF')
    .setTitle('You have been challenged to a battle!')
    .setDescription('A **Test Monster** has appeared! Get ready to defend yourself!');

const start_button: MessageButton = new MessageButton()
    .setCustomId('start')
    .setLabel('Start Battle')
    .setStyle('PRIMARY');

const flee_button: MessageButton = new MessageButton()
    .setCustomId('flee')
    .setLabel('Flee Battle')
    .setStyle('PRIMARY')
    .setDisabled(true);

const battle_row: MessageActionRow = new MessageActionRow()
    .addComponents([start_button, flee_button]);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('scuffle')
		.setDescription('Begins a test battle with a test fighter and a test monster.'),
	execute: async function(interaction: any) {
		logger.info("Running scuffle Command");
		await interaction.reply(
            {
                embeds: [battle_embed],
                components: [
                    battle_row
                ]
            }
        );
	},
};
