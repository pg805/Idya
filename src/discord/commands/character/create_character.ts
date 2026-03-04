import { ActionRowBuilder, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import CharacterRepository from '../../../character/character_repository.js';
import logger from '../../../utility/logger.js';

const repo = new CharacterRepository();

export default {
    data: new SlashCommandBuilder()
        .setName('createcharacter')
        .setDescription('Create your character to begin your adventure!'),
    execute: async function(interaction: any) {
        logger.info(`Create Character command from ${interaction.user.id}`);

        if ((await repo.list(interaction.user.id)).length >= 1) {
            await interaction.reply({
                content: 'You already have a character! Use `/profile` to view them.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId('CreateCharModal')
            .setTitle('Create Your Character');

        const name_input = new TextInputBuilder()
            .setCustomId('CreateCharNameInput')
            .setLabel('Character Name')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(32)
            .setPlaceholder('Enter your character\'s name...')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name_input));
        await interaction.showModal(modal);
    }
};
