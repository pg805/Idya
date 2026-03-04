import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import CharacterRepository from '../../../character/character_repository.js';
import Non_Player_Character from '../../../character/non_player_character.js';
import battle_handler, { BattleHandler } from '../../handlers/battle_handler.js';
import logger from '../../../utility/logger.js';

const repo = new CharacterRepository();

const ENEMY_FILES: Record<string, { file: string; start_string: string }> = {
    rat:      { file: './database/enemies/rat.yaml',      start_string: 'The rat is defending itself, giving you time to plan! (Recommended: Special)' },
    zombie:   { file: './database/enemies/zombie.yaml',   start_string: 'The zombie is winding up to attack! (Recommended: Defend)' },
    mushroom: { file: './database/enemies/mushroom.yaml', start_string: 'The mushroom is preparing something! (Recommended: Attack)' },
};

export default {
    data: new SlashCommandBuilder()
        .setName('battle')
        .setDescription('Fight a monster with your character!')
        .addStringOption(opt =>
            opt.setName('enemy')
                .setDescription('Which monster to fight')
                .setRequired(true)
                .addChoices(
                    { name: 'Rat (Easy)',         value: 'rat' },
                    { name: 'Zombie (Medium)',     value: 'zombie' },
                    { name: 'Mushroom (Hard)',     value: 'mushroom' },
                )
        ),
    execute: async function(interaction: any) {
        const discord_id = interaction.user.id as string;
        logger.info(`Battle command from ${discord_id}`);

        const characters = await repo.list(discord_id);
        if (characters.length === 0) {
            await interaction.reply({
                content: 'You don\'t have a character yet! Use `/createcharacter` first.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const char_data = characters[0];
        const player    = repo.to_player_character(char_data);

        const enemy_key = interaction.options.getString('enemy') as string;
        const entry     = ENEMY_FILES[enemy_key];
        const enemy     = Non_Player_Character.from_file(entry.file);

        if (!enemy.loot_table) {
            await interaction.reply({ content: 'This enemy has no loot table configured.', flags: MessageFlags.Ephemeral });
            return;
        }

        battle_handler.store(discord_id, {
            character:    player,
            enemy,
            discord_id,
            character_id: char_data.id,
            loot_table:   enemy.loot_table,
            start_string: entry.start_string,
        });

        await interaction.reply({
            embeds:     [BattleHandler.build_ready_embed(player, enemy)],
            components: [BattleHandler.build_ready_row()],
        });
    }
};
