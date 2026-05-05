import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Open the crafting bench.'),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
