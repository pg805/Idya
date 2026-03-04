import { ActionRowBuilder, bold, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Snowflake } from "discord.js";
import BattleManager from "./battle_manager.js";
import logger from "../../utility/logger.js";
import Action from "../../weapon/action.js";
import Weapon from "../../weapon/weapon.js";
import Player_Character from "../../character/player_character.js";
import Non_Player_Character from "../../character/non_player_character.js";

export class DemoHandler {
    demos:               Record<Snowflake, string>           = {}   // message_id → npc key
    pending_characters:  Record<string, Player_Character>    = {}   // user_id → character

    constructor() {}
}

export const demo_handler = new DemoHandler();

export const enemy_select_embed: EmbedBuilder = new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('An enemy approaches!')
    .setDescription('You get a good glimpse of the creature!')
    .addFields(
        {name: 'Rat (Easiest)', value: 'A rat sits poised on it\'s hind legs, ready to attack!', inline: true},
        {name: 'Zombie', value: 'A zombie ambles into the field, hungry for brains!', inline: true},
        {name: 'Mushroom', value: 'A walking mushroom bumps into your legs, which gets a bit itchy...', inline: true}
    )

export const enemy_select_row: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('DemoEnemyRatSelect')
            .setLabel('Rat')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('DemoEnemyZombieSelect')
            .setLabel('Zombie')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('DemoEnemyMushroomSelect')
            .setLabel('Mushroom')
            .setStyle(ButtonStyle.Primary),
    )

const enemy_confirm_embed = new EmbedBuilder()
    .setColor(0x00FFFF)

const enemy_confirm_row: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('DemoEnemyDeny')
            .setLabel('Go Back')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('DemoEnemyConfirm')
            .setLabel('Continue')
            .setStyle(ButtonStyle.Primary),
    )

export default function demo_battle(interaction: ButtonInteraction, handler: DemoHandler, battle_manager: BattleManager) {
    switch(interaction.customId) {
        case 'DemoEnemyRatSelect':
            logger.info('Rat selected as Enemy!')
            handler.demos[interaction.message.id] = 'rat'
            enemy_confirm_embed.setTitle('A Rat Approaches!')
                .setDescription('Are you sure you want to fight a rat?')
            interaction.update({
                embeds: [enemy_confirm_embed],
                components: [enemy_confirm_row]
            })
            break;
        case 'DemoEnemyZombieSelect':
            logger.info('Zombie selected as Enemy!')
            handler.demos[interaction.message.id] = 'zombie'
            enemy_confirm_embed.setTitle('A Zombie Approaches!')
                .setDescription('Are you sure you want to fight a zombie?')
            interaction.update({
                embeds: [enemy_confirm_embed],
                components: [enemy_confirm_row]
            })
            break;
        case 'DemoEnemyMushroomSelect':
            logger.info('Mushroom selected as Enemy!')
            handler.demos[interaction.message.id] = 'mushroom'
            enemy_confirm_embed.setTitle('A Mushroom Approaches!')
                .setDescription('Are you sure you want to fight a mushroom?')
            interaction.update({
                embeds: [enemy_confirm_embed],
                components: [enemy_confirm_row]
            })
            break;
        case 'DemoEnemyConfirm': {
            logger.info('Enemy Confirmed!')

            const player = handler.pending_characters[interaction.user.id];
            if (!player) {
                interaction.reply({ content: 'Session expired. Run `/demobattle` again.', ephemeral: true });
                break;
            }
            delete handler.pending_characters[interaction.user.id];

            let enemy      = Non_Player_Character.from_file('./database/enemies/rat.yaml');
            let start_string = '';

            switch(handler.demos[interaction.message.id]) {
                case 'rat':
                    enemy        = Non_Player_Character.from_file('./database/enemies/rat.yaml')
                    start_string = 'The rat is defending itself, giving you time to plan your next move carefully! (Recommended action - Special)'
                    break;
                case 'zombie':
                    enemy        = Non_Player_Character.from_file('./database/enemies/zombie.yaml')
                    start_string = 'The zombie is attacking, defend yourself quickly! (Recommended action - Defend)'
                    break;
                case 'mushroom':
                    enemy        = Non_Player_Character.from_file('./database/enemies/mushroom.yaml')
                    start_string = 'The mushroom is preparing, hit it before it can release! (Recommended action - Attack)'
                    break;
            }

            battle_manager.button_start_battle(interaction, player, enemy, start_string)
            break;
        }
        case 'DemoEnemyDeny':
            logger.info('Enemy Denied!')
            interaction.update({
                embeds: [enemy_select_embed],
                components: [enemy_select_row]
            })
            break;
        default:
            logger.warn(`Unrecognized Demo Button: ${interaction.customId}`)
    }
}
