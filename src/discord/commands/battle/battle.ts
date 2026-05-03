import { SlashCommandBuilder } from 'discord.js';

// Interaction is handled by the server (src/server/index.ts).
// This file exists for command registration via deploy-commands.
export default {
    data: new SlashCommandBuilder()
        .setName('battle')
        .setDescription('Start a battle against a monster!'),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
