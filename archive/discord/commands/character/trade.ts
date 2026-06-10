import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Propose a trade with another player.')
        .addUserOption(opt =>
            opt.setName('user').setDescription('Player to trade with.').setRequired(true)
        ),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
