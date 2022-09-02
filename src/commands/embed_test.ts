import { MessageEmbed } from "discord.js";
import logger from "../util/logger";

const { SlashCommandBuilder } = require('@discordjs/builders');

const battle_embed: MessageEmbed = new MessageEmbed()
    .setColor('#00FFFF')
    .setTitle('Battle!')
    .setDescription('=========\n**Round**: 12\n=========\n**Health Left**');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('embedtest')
		.setDescription('embed test time!'),
    execute: async function(interaction: any) {
        logger.info("Running embed Command");
        await interaction.reply(
            {
                embeds: [battle_embed],
            }
        );
    },
};