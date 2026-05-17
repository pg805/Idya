import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('hunt')
        .setDescription('Use bait to hunt in the forest.'),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
