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
        )
        .addSubcommand(sub =>
            sub.setName('giveweapon')
                .setDescription('Give a character a weapon by key')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Target user')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('weapon')
                        .setDescription('Weapon key (filename without .yaml)')
                        .setRequired(true)
                )
        ),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
