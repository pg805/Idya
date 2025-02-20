import logger from '../utility/logger.js';

import { ActionRowBuilder, bold, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Interaction, Snowflake } from "discord.js";
import Battle from "../combat/battle.js";
import Player_Character from "../character/player_character.js";
import Non_Player_Character from "../character/non_player_character.js";

export default class BattleManager {
    running_battles: { [key: Snowflake]: Battle} = {}

    constructor() {}

    find_battle(message_id: Snowflake) {
        return this.running_battles[message_id]
    }

    async button_handler(interaction: ButtonInteraction) {

    }

    async button_start_battle(interaction: ButtonInteraction, player_character: Player_Character, non_player_character: Non_Player_Character, start_string: string = '', color: number = 0x00FFFF) {
        logger.info(`Starting battle between ${player_character.name} and ${non_player_character.name}.  ID: ${interaction.message.id}`)

        this.running_battles[interaction.message.id] = new Battle(
            player_character,
            non_player_character
        )

        let round_string = ''
        
        if(start_string) {
            round_string = `\n-------------------------\n${start_string}`
        }


        const battle_embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`Battle against ${non_player_character.name}`)
            .setDescription(`Battle between ${player_character.name} and ${non_player_character.name} starting!${round_string}`)
            .setFields({
                name: "Player Character",
                value: `${player_character.health}`,
                inline: true
                },{
                name: "Rat",
                value: `${non_player_character.health}`,
                inline: true
                },
            )

        const image_embed_test = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(player_character.image)
        const image_embed_test_2 = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(non_player_character.image)

        const battle_action_row = new ActionRowBuilder<ButtonBuilder>()
            .setComponents(
                new ButtonBuilder()
                    .setCustomId('BattleDefend')
                    .setLabel(player_character.weapon.defend_name())
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('BattleAttack')
                    .setLabel(player_character.weapon.attack_name())
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('BattleSpecial')
                    .setLabel(player_character.weapon.special_name())
                    .setStyle(ButtonStyle.Primary)
            )

        await interaction.update({
            embeds: [image_embed_test, image_embed_test_2, battle_embed],
            components: [battle_action_row]
        })
    }

    button_update_battle(interaction: ButtonInteraction, extra_string: string = '') {
        const battle: Battle = this.find_battle(interaction.message.id)
        logger.info(`Updating battle between ${battle.player_character.name} and ${battle.non_player_character.name}.  ID: ${interaction.message.id}`)
        logger.debug(`NPC Action: ${battle.npc_index}`)

        let round_object:  {
            action_string: string,
            winner: string
        } = {
            action_string: '',
            winner: ''
        };

        switch(interaction.customId) {
            case 'BattleDefend':
                round_object = battle.resolve_round(1)
                break;
            case 'BattleAttack':
                round_object = battle.resolve_round(2)
                break;
            case 'BattleSpecial':
                round_object = battle.resolve_round(3)
                break;
        }

        let winner_string = ''
        let round_string = ''
        const defend_button: ButtonBuilder = new ButtonBuilder()
            .setCustomId('BattleDefend')
            .setLabel(battle.player_character.weapon.defend_name())
            .setStyle(ButtonStyle.Primary)
        const attack_button: ButtonBuilder = new ButtonBuilder()
            .setCustomId('BattleAttack')
            .setLabel(battle.player_character.weapon.attack_name())
            .setStyle(ButtonStyle.Primary)
        const special_button: ButtonBuilder = new ButtonBuilder()
            .setCustomId('BattleSpecial')
            .setLabel(battle.player_character.weapon.special_name())
            .setStyle(ButtonStyle.Primary)

        if(extra_string) {
            round_string = `\n-------------------------\n${extra_string}`
        }

        if(round_object.winner) {
            winner_string = `\n-------------------------\n${round_object.winner} wins!`

            defend_button.setDisabled()
            attack_button.setDisabled()
            special_button.setDisabled()

            this.running_battles = Object.fromEntries(
                Object.entries(this.running_battles).filter(([key]) => key !== interaction.message.id)
            );

            logger.info(`Battle ${interaction.message.id} Finished.  Log:\n${battle.log.join('\n')}`)
        }

        const battle_action_row = new ActionRowBuilder<ButtonBuilder>()
            .setComponents(
                defend_button,
                attack_button,
                special_button
            )

        const description: string = `${round_object.action_string}${round_string}${winner_string}`
            .replace(/(\d+)|(\brounds?)|(\bblock(ed)?)|(\bDOT)|(\bdamage)|(\bstrike)|(\b(de)?buff)|(\bheal(ing)?)|(\breflect(ed|ing)?)|(\bshield(ing)?)/gi, (match: string) => bold(match))

        const image_embed_test = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(battle.player_character.image)
        const image_embed_test_2 = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(battle.non_player_character.image)

        const battle_embed = EmbedBuilder.from(interaction.message.embeds[2])
            .setDescription(description)
            .setFields({
                name: "Player Character",
                value: `${battle.pc_object.health}`,
                inline: true
                },{
                name: "Rat",
                value: `${battle.npc_object.health}`,
                inline: true
                },
            )

        interaction.update({
            embeds: [image_embed_test, image_embed_test_2, battle_embed],
            components: [battle_action_row]
        })
    }
}