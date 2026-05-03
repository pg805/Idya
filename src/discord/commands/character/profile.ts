import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your character profile.'),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
