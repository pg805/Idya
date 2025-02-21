import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder } from "discord.js";
import BattleManager from "../battle_manager.js";
import logger from "../../utility/logger.js";
import Weapon from "../../weapon/weapon.js";
import Action from "../../weapon/action.js";

export const weapon_select_embed: EmbedBuilder = new EmbedBuilder()
    .setColor(0x00FFFF)
    .setTitle('An enemy approaches!')
    .setDescription('As you wake up in a large, grassy field, several objects lie around you.  A hissing sound turns your attention to your left.  You are being attacked!  You have the chance to grab one item to fight back!')
    .addFields(
        {name: 'Shovel (Recommended)', value: 'A rusty shovel sits before you.  Seems like it\'s still sturdy!', inline: true},
        {name: 'Deck of Cards', value: 'A full deck of cards sits before you.  Could be sharp...', inline: true},
        {name: 'Can of Paint', value: 'A can of paint sits before you.  Could you ... paint the rat?', inline: true},
        {name: 'Awakened Mind', value: 'You see a pebble sitting in the grass before you.  For some reason you feel a kinship with it.', inline: true},
        {name: 'Path of Vines and Thorns', value: 'The foilage in the area seems to be calling to you, asking you to help it get rid of this intruder.', inline: true}
    )

export const weapon_select_row: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('DemoBattleShovelSelect')
            .setLabel('Shovel')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('DemoBattleCardsSelect')
            .setLabel('Deck Of Cards')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('DemoBattlePaintSelect')
            .setLabel('Can of Paint')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('DemoBattleBrainSelect')
            .setLabel('Awakened Mind')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('DemoBattleVineSelect')
            .setLabel('Path of Vines and Thorns')
            .setStyle(ButtonStyle.Primary),
    )

function build_weapon_confirm(weapon: Weapon) {

    const fields = []
    fields.push({
        name: `Defend: ${weapon.defend.map((action: Action) => action.name).join('/')}`,
        value: weapon.defend.map((action: Action) => action.get_description()).join('\n'),
        inline: true
    })
    fields.push({
        name: `Attack: ${weapon.attack.map((action: Action) => action.name).join('/')}`,
        value: weapon.attack.map((action: Action) => action.get_description()).join('\n'),
        inline: true
    })
    fields.push({
        name: `Attack Crit: ${weapon.attack_crit.map((action: Action) => action.name).join('/')}`,
        value: weapon.attack_crit.map((action: Action) => action.get_description()).join('\n'),
        inline: true
    })
    fields.push({
        name: `Special: ${weapon.special.map((action: Action) => action.name).join('/')}`,
        value: weapon.special.map((action: Action) => action.get_description()).join('\n'),
        inline: true
    })

    const weapon_confirm_embed: EmbedBuilder = new EmbedBuilder()
        .setColor(0x00FFFF)
        .setTitle(`You pick up ${weapon.name}!`)
        .setDescription(`You pick up ${weapon.name}\n${weapon.description}`)
        .setFields(fields)

    const weapon_confirm_row: ActionRowBuilder<ButtonBuilder> = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('DemoConfirmWeapon')
                .setLabel('Continue')
                .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                .setCustomId('DemoDenyWeapon')
                .setLabel('Go Back')
                .setStyle(ButtonStyle.Primary),
        )

    return {
        embeds: [weapon_confirm_embed],
        components: [weapon_confirm_row]
    }
}

export default function demo_battle(interaction: ButtonInteraction, battle_manager: BattleManager) {
    switch(interaction.customId) {
        case 'DemoBattleShovelSelect':
            interaction.update(build_weapon_confirm(Weapon.from_file('./database/weapons/shovel.json')))
            break;
        case 'DemoBattleCardsSelect':
            interaction.update(build_weapon_confirm(Weapon.from_file('./database/weapons/deck_of_cards.json')))
            break;
        case 'DemoBattlePaintSelect':
            interaction.update(build_weapon_confirm(Weapon.from_file('./database/weapons/can_of_paint.json')))
            break;
        case 'DemoBattleBrainSelect':
            interaction.update(build_weapon_confirm(Weapon.from_file('./database/weapons/awakened_mind.json')))
            break;
        case 'DemoBattleVineSelect':
            interaction.update(build_weapon_confirm(Weapon.from_file('./database/weapons/vine_and_thorn.json')))
            break;
        case 'DemoConfirmWeapon':
            break;
        case 'DemoDenyWeapon':
            interaction.update({
                embeds: [weapon_select_embed],
                components: [weapon_select_row]
            })
            break;
        case 'DemoEnemyRatSelect':
            break;
        case 'DemoEnemyZombieSelect':
            break;
        case 'DemoEnemyMushroomSelect':
            break;
        case 'DemoEnemyConfirm':
            break;
        case 'DemoEnemyDeny':
            break;
        default:
            logger.warn(`Unrecognized Demo Button: ${interaction.customId}`)
    }
}