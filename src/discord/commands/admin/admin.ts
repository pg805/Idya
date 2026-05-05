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
        )
        .addSubcommand(sub =>
            sub.setName('givekorel')
                .setDescription('Give korel to a user')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Target user')
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('amount')
                        .setDescription('Amount of korel to give (can be negative)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('giveitem')
                .setDescription('Give an item to a user\'s character')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('Target user')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('Item ID (e.g. spores, wood, iron_ore)')
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('quantity')
                        .setDescription('Quantity to give')
                        .setRequired(false)
                )
        ),
    execute: async function(_interaction: any) {
        // Handled by the Discord client in src/server/index.ts
    }
};
