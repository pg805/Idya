import { SlashCommandBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('dev')
        .setDescription('Dev-only commands')
        .addSubcommand(sub =>
            sub.setName('resetcharacter')
                .setDescription('Delete a user\'s character and reset tutorial')
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
