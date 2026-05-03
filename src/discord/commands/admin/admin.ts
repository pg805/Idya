import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin-only commands')
        .addSubcommand(sub =>
            sub.setName('joinsim')
                .setDescription('Simulate the server join flow for a user')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Target user')
                        .setRequired(true)
                )
        ),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
