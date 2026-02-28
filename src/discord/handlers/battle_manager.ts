import logger from '../../utility/logger.js';

import { ActionRowBuilder, bold, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Snowflake } from "discord.js";
import Battle from "../../combat/battle.js";
import Player_Character from "../../character/player_character.js";
import Non_Player_Character from "../../character/non_player_character.js";
import { Stance } from '../../infrastructure/stance.js';
import Action from '../../weapon/action.js';

export class DemoHandler {
    demos: { [key: Snowflake]: {
        'Human': string,
        'NPC': string
    }} = {}

    constructor() {}
}

export default class BattleManager {
    running_battles:  { [key: Snowflake]: Battle }  = {}
    pending_stances:  { [key: Snowflake]: Stance }  = {}

    constructor() {}

    find_battle(message_id: Snowflake) {
        return this.running_battles[message_id]
    }

    bold_keywords(description: string) {
        return description
            .replace(/(\d+)|(\brounds?)|(\bblock(ed|ing)?)|(\bDOT)|(\bdamage)|(\bstrike)|(\b(de)?buff(ing)?)|(\bheal(ing)?)|(\breflect(ed|ing)?)|(\bshield(ing)?)|(\bDefensive\b)|(\bBalanced\b)|(\bAggressive\b)/gi, (match: string) => bold(match))
    }

    private make_stance_row(selected?: Stance, disabled = false) {
        return new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
                .setCustomId('StanceD')
                .setLabel(selected === Stance.Defensive ? '✓ Defensive' : 'Defensive')
                .setStyle(selected === Stance.Defensive ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId('StanceB')
                .setLabel(selected === Stance.Balanced ? '✓ Balanced' : 'Balanced')
                .setStyle(selected === Stance.Balanced ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId('StanceA')
                .setLabel(selected === Stance.Aggressive ? '✓ Aggressive' : 'Aggressive')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled),
        )
    }

    private make_action_row(battle: Battle, disabled: boolean) {
        const buttons: ButtonBuilder[] = [];
        const weapon = battle.player_character.weapon;

        weapon.defend.forEach((action: Action, index: number) => {
            buttons.push(new ButtonBuilder()
                .setCustomId(`BattleD${index}`)
                .setLabel(`(D) ${action.name}`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled));
        });

        weapon.attack.forEach((action: Action, index: number) => {
            buttons.push(new ButtonBuilder()
                .setCustomId(`BattleA${index}`)
                .setLabel(`(A) ${action.name}`)
                .setStyle(ButtonStyle.Danger)
                .setDisabled(disabled));
        });

        weapon.special.forEach((action: Action, index: number) => {
            buttons.push(new ButtonBuilder()
                .setCustomId(`BattleS${index}`)
                .setLabel(`(S) ${action.name}`)
                .setStyle(ButtonStyle.Success)
                .setDisabled(disabled));
        });

        return new ActionRowBuilder<ButtonBuilder>().setComponents(buttons);
    }

    async button_start_battle(interaction: ButtonInteraction, player_character: Player_Character, non_player_character: Non_Player_Character, start_string: string = '', color: number = 0x00FFFF) {
        logger.info(`Starting battle between ${player_character.name} and ${non_player_character.name}.  ID: ${interaction.message.id}`)

        const battle = new Battle(player_character, non_player_character)
        this.running_battles[interaction.message.id] = battle

        let round_string = ''
        if(start_string) {
            round_string = `\n-------------------------\n${start_string}`
        }

        const description = this.bold_keywords(`Battle between ${player_character.name} and ${non_player_character.name} starting!\n\nChoose your stance, then your action.${round_string}`)

        const battle_embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`Battle against ${non_player_character.name}`)
            .setDescription(description)
            .setFields(
                { name: "Player Character", value: `${player_character.health}`, inline: true },
                { name: non_player_character.name, value: `${non_player_character.health}`, inline: true },
            )

        const image_embed_1 = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(player_character.image)
        const image_embed_2 = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(non_player_character.image)

        await interaction.update({
            embeds: [image_embed_1, image_embed_2, battle_embed],
            components: [
                this.make_stance_row(),
                this.make_action_row(battle, true)
            ]
        })
    }

    button_select_stance(interaction: ButtonInteraction) {
        const stance: Stance =
            interaction.customId === 'StanceD' ? Stance.Defensive  :
            interaction.customId === 'StanceA' ? Stance.Aggressive :
            Stance.Balanced;

        this.pending_stances[interaction.message.id] = stance;

        const battle = this.find_battle(interaction.message.id)
        logger.info(`Stance selected: ${stance} for battle ${interaction.message.id}`)

        const image_embed_1 = EmbedBuilder.from(interaction.message.embeds[0])
        const image_embed_2 = EmbedBuilder.from(interaction.message.embeds[1])
        const battle_embed  = EmbedBuilder.from(interaction.message.embeds[2])

        interaction.update({
            embeds: [image_embed_1, image_embed_2, battle_embed],
            components: [
                this.make_stance_row(stance),
                this.make_action_row(battle, false)
            ]
        })
    }

    button_update_battle(interaction: ButtonInteraction, extra_string: string = '') {
        const battle: Battle = this.find_battle(interaction.message.id)
        logger.info(`Updating battle between ${battle.player_character.name} and ${battle.non_player_character.name}.  ID: ${interaction.message.id}`)

        const player_stance: Stance = this.pending_stances[interaction.message.id] ?? Stance.Balanced
        delete this.pending_stances[interaction.message.id]

        let round_object: { action_string: string, winner: string } = { action_string: '', winner: '' }

        const type_char = interaction.customId[6]; // 'D', 'A', or 'S'
        const action_index = parseInt(interaction.customId.slice(7));
        const player_action = type_char === 'D' ? 1 : type_char === 'A' ? 2 : 3;
        round_object = battle.resolve_round(player_action, action_index, player_stance);

        let winner_string = ''
        let round_string  = ''

        if(extra_string) {
            round_string = `\n-------------------------\n${extra_string}`
        }

        const battle_over = !!round_object.winner
        if(battle_over) {
            winner_string = `\n-------------------------\n${round_object.winner} wins!`

            this.running_battles = Object.fromEntries(
                Object.entries(this.running_battles).filter(([key]) => key !== interaction.message.id)
            )

            logger.info(`Battle ${interaction.message.id} Finished.  Log:\n${battle.log.join('\n')}`)
        }

        const description: string = this.bold_keywords(`${round_object.action_string}${round_string}${winner_string}`)

        const image_embed_1 = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(battle.player_character.image)
        const image_embed_2 = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setURL("https://example.org/")
            .setImage(battle.non_player_character.image)

        const battle_embed = EmbedBuilder.from(interaction.message.embeds[2])
            .setDescription(description)
            .setFields(
                { name: "Player Character", value: `${battle.pc_object.health}`, inline: true },
                { name: battle.npc_object.name, value: `${battle.npc_object.health}`, inline: true },
            )

        const components = [
            this.make_stance_row(undefined, battle_over),  // disabled when battle over
            this.make_action_row(battle, true)             // always disabled until next stance pick
        ]

        interaction.update({
            embeds: [image_embed_1, image_embed_2, battle_embed],
            components
        })
    }
}
