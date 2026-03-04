import logger from "../../../utility/logger.js";
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { demo_handler, enemy_select_embed, enemy_select_row } from "../../handlers/demo_handler.js";
import CharacterRepository from "../../../character/character_repository.js";

const repo = new CharacterRepository();

export default {
    data: new SlashCommandBuilder()
        .setName('demobattle')
        .setDescription('Battle against a monster to learn the combat system!'),
    execute: async function(interaction: any) {
        logger.info(`Demo Battle command from ${interaction.user.id}`);

        const characters = await repo.list(interaction.user.id);
        if (characters.length === 0) {
            await interaction.reply({
                content: 'You need a character first! Use `/createcharacter` to get started.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const player = repo.to_player_character(characters[0]);
        demo_handler.pending_characters[interaction.user.id] = player;

        await interaction.reply({
            embeds: [enemy_select_embed],
            components: [enemy_select_row]
        });
    },
};
