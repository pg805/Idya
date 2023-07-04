import { ButtonInteraction, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import logger from "../util/logger";
import State, { initializeState } from "../_store/state";
import PlayerCharacter from "../types/character/playerCharacter";
import smole from "../npc_manual/smole";
import player from "../testBattle/testPlayer";
import { defineNpcIntent } from "./promptIntent";
import NonPlayerCharacter from "../types/character/nonPlayerCharacter";
import Item from "../types/item";
import Action from "../types/action";
import { ACTION_TYPES } from "../types/actionType";
import * as fs from "fs";

function createBattleEmbed(state: State): MessageEmbed {
    const description = `==========================================================================
**Round:** ${state.round}
==========================================================================
**Action Log**
==========================================================================
**End of Turn Log**
==========================================================================
**Health Left**:
${state.playerCharacters.map((pc: PlayerCharacter) => pc.name + ': ' + pc.currentHp + '/' + pc.totalHp).join('\n')}
${state.nonPlayerCharacters.map((npc: NonPlayerCharacter) => npc.name + ': ' + npc.currentHp + '/' + npc.totalHp).join('\n')}
==========================================================================
Choose your action!!!`

return new MessageEmbed().setColor('#00FFFF')
    .setTitle('Battle!')
    .setDescription(description)
}

function createBattleRow(state:State): MessageActionRow[] {
    const attackButtons: MessageButton[] = []
    const defendButtons: MessageButton[] = []
    const specialButtons: MessageButton[] = []

    const attackItems: Item[] = state.playerCharacters[0].activeItems.filter((item: Item) => item.actions.filter((action:Action) => action.actionType.type == ACTION_TYPES.ATTACK))
    const defendItems: Item[] = state.playerCharacters[0].activeItems.filter((item: Item) => item.actions.filter((action:Action) => action.actionType.type == ACTION_TYPES.DEFEND))
    const specialItems: Item[] = state.playerCharacters[0].activeItems.filter((item: Item) => item.actions.filter((action:Action) => action.actionType.type == ACTION_TYPES.SPECIAL))

    attackItems.forEach((item: Item) => {
        item.actions.filter((action: Action) => {
            action.actionType.type == ACTION_TYPES.ATTACK
        }).forEach((action: Action) => {
            attackButtons.push(new MessageButton()
                .setStyle('PRIMARY')
                .setCustomId(`battle action ${action.name} ${state.id}`)
                .setLabel(action.name))
        })
    })

    defendItems.forEach((item: Item) => {
        item.actions.filter((action: Action) => {
            action.actionType.type == ACTION_TYPES.DEFEND
        }).forEach((action: Action) => {
            defendButtons.push(new MessageButton()
                .setStyle('PRIMARY')
                .setCustomId(`battle action ${action.name} ${state.id}`)
                .setLabel(action.name))
        })
    })

    specialItems.forEach((item: Item) => {
        item.actions.filter((action: Action) => {
            action.actionType.type == ACTION_TYPES.SPECIAL
        }).forEach((action: Action) => {
            specialButtons.push(new MessageButton()
                .setStyle('PRIMARY')
                .setCustomId(`battle action ${action.name} ${state.id}`)
                .setLabel(action.name))
        })
    })

    return [new MessageActionRow().addComponents(defendButtons),new MessageActionRow().addComponents(attackButtons),new MessageActionRow().addComponents(specialButtons)]
}

async function startBattle(interaction: ButtonInteraction) {
    const newBattle: State = initializeState();

    newBattle.playerCharacters.push(player)
    newBattle.nonPlayerCharacters.push(smole)

    defineNpcIntent(newBattle)
    const battle_embed: MessageEmbed = createBattleEmbed(newBattle);
    const battle_rows: MessageActionRow[] = createBattleRow(newBattle)

    fs.writeFile(`./data/battles/${newBattle.id}.json`, JSON.stringify(newBattle.toJSON(), null, 4), (error) => {
        if (error) {
            // logging the error
            logger.error(error);
        
            throw error;
        }

        logger.info(`./data/battles/${newBattle.id}.json successfully written`)
    })

    await interaction.reply({
        embeds: [battle_embed],
        components: battle_rows
    });
}

async function handleAction(interaction: ButtonInteraction) {

    await fs.readFile(`./data/battles/${newBattle.id}.json`, (error, battleFile) => {
        if (error) {
            // logging the error
            logger.error(error);
        
            throw error;
        }

        logger.info(`./data/battles/${newBattle.id}.json successfully written`)
    })

    const battle: State = State.fromJSON(JSON.parse(battleFile))

    const battle_embed: MessageEmbed = createBattleEmbed(newBattle);
    const battle_rows: MessageActionRow[] = createBattleRow(newBattle)

    await interaction.reply({
        embeds: [battle_embed],
        components: battle_rows
    });
}

export function handleBattleButton(interaction: ButtonInteraction) {
    switch(interaction.customId) {
        case interaction.customId.match(/^battle\sstart/)?.input:
            startBattle(interaction);
            break;
        case interaction.customId.match(/^battle\saction/)?.input:
            handleAction(interaction)
            break;
        default:
            logger.error("Unkown Button Pressed");
            logger.error(`Channel - ${interaction.channelId}`);
            logger.error(`User - ${interaction.user.id}`);
    }
}