import { MessageEmbed, MessageButton, MessageActionRow } from "discord.js";
import logger from "../util/logger";

const { SlashCommandBuilder } = require('@discordjs/builders');

const battle_embed: MessageEmbed = new MessageEmbed()
    .setColor('#00FFFF')
    .setTitle('Battle!')
    .setDescription('=========\n**Round**: 12\n=========\n**Health Left**');

const defend_1: MessageButton = new MessageButton()
    .setCustomId('d1')
    .setLabel('Defend 1')
    .setStyle('PRIMARY');

// const defend_2: MessageButton = new MessageButton()
//     .setCustomId('d2')
//     .setLabel('Defend 2')
//     .setStyle('PRIMARY')

const attack_1: MessageButton = new MessageButton()
    .setCustomId('a1')
    .setLabel('Attack 1')
    .setStyle('PRIMARY');

// const attack_2: MessageButton = new MessageButton()
//     .setCustomId('a2')
//     .setLabel('Attack 2')
//     .setStyle('PRIMARY')

const special_1: MessageButton = new MessageButton()
    .setCustomId('s1')
    .setLabel('Special 1')
    .setStyle('PRIMARY');

// const special_2: MessageButton = new MessageButton()
//     .setCustomId('s2')
//     .setLabel('Attack 2')
//     .setStyle('PRIMARY')

const defend_row: MessageActionRow = new MessageActionRow()
    .addComponents([defend_1]);

const attack_row: MessageActionRow = new MessageActionRow()
    .addComponents([attack_1]);

const special_row: MessageActionRow = new MessageActionRow()
    .addComponents([special_1]);

module.exports = {
	data: new SlashCommandBuilder()
		.setName('embedtest')
		.setDescription('embed test time!'),
    execute: async function(interaction: any) {
        logger.info("Running embed Command");
        await interaction.reply(
            {
                embeds: [battle_embed],
                components: [
                    defend_row,
                    attack_row,
                    special_row
                ]
            }
        );
    },
};