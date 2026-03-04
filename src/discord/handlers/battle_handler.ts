import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder } from 'discord.js';
import Player_Character from '../../character/player_character.js';
import Non_Player_Character from '../../character/non_player_character.js';
import type { LootTable } from '../../economy/reward_service.js';
import type BattleManager from './battle_manager.js';
import logger from '../../utility/logger.js';

type PendingBattle = {
    character:    Player_Character;
    enemy:        Non_Player_Character;
    discord_id:   string;
    character_id: string;
    loot_table:   LootTable;
    start_string: string;
};

export class BattleHandler {
    private pending: Record<string, PendingBattle> = {};

    store(user_id: string, data: PendingBattle) {
        this.pending[user_id] = data;
    }

    async handle_start(interaction: ButtonInteraction, battle_manager: BattleManager) {
        const data = this.pending[interaction.user.id];
        if (!data) {
            await interaction.reply({ content: 'Battle session expired. Run `/battle` again.', ephemeral: true });
            return;
        }
        delete this.pending[interaction.user.id];
        logger.info(`Starting rewarded battle for ${interaction.user.id}: ${data.character.name} vs ${data.enemy.name}`);

        await battle_manager.button_start_battle(
            interaction,
            data.character,
            data.enemy,
            data.start_string,
            0x00FF44,
            { discord_id: data.discord_id, character_id: data.character_id, loot_table: data.loot_table }
        );
    }

    static build_ready_embed(character: Player_Character, enemy: Non_Player_Character): EmbedBuilder {
        return new EmbedBuilder()
            .setColor(0x00FF44)
            .setTitle(`Battle: ${character.name} vs ${enemy.name}`)
            .setDescription(`**${character.name}** is ready to fight **${enemy.name}**!\n\nHP: ${character.health}\nPress **Fight!** to begin.`);
    }

    static build_ready_row(): ActionRowBuilder<ButtonBuilder> {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('RwBattleStart')
                .setLabel('Fight!')
                .setStyle(ButtonStyle.Success)
        );
    }
}

export default new BattleHandler();
