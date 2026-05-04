import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('weapon')
        .setDescription('Equip a weapon from your inventory.'),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
