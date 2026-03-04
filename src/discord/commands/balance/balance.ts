import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import prisma from '../../../database/prisma.js';
import CharacterRepository from '../../../character/character_repository.js';
import logger from '../../../utility/logger.js';

const repo = new CharacterRepository();

export default {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your currency and character inventory.'),
    execute: async function(interaction: any) {
        const discord_id = interaction.user.id as string;
        logger.info(`Balance command from ${discord_id}`);

        const user = await prisma.user.findUnique({ where: { discord_id } });
        if (!user) {
            await interaction.reply({
                content: 'You don\'t have an account yet! Use `/createcharacter` to get started.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const characters = await repo.list(discord_id);
        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`${interaction.user.username}'s Balance`)
            .setDescription(`Currency: **${user.currency}**`);

        for (const char of characters) {
            const inventory = await prisma.inventoryItem.findMany({
                where:   { character_id: char.id },
                include: { item: true }
            });

            const inv_text = inventory.length > 0
                ? inventory.map(i => `${i.quantity}x ${i.item.name}`).join('\n')
                : 'Empty';

            embed.addFields({ name: `${char.name}'s Inventory`, value: inv_text, inline: false });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
