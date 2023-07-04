import { ButtonInteraction, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import logger from "../util/logger";
import State, { initializeState } from "../_store/state";
import PlayerCharacter from "../types/character/playerCharacter";
import smole from "../npc_manual/smole";
import player from "../testBattle/testPlayer";
import { defineNpcIntent, definePCIntent } from "./promptIntent";
import NonPlayerCharacter from "../types/character/nonPlayerCharacter";
import Item from "../types/item";
import Action from "../types/action";
import { ACTION_TYPES } from "../types/actionType";
import * as fs from "fs";
import Player from "../combat_old/player";
import { resolveRound } from "./resolveIntent";

const breaker: string = '======================================================================';

function createBattleEmbed(state: State): MessageEmbed {
    const description = `${breaker}
**Round:** ${state.round}
${breaker}
**Action Log**
${breaker}
**End of Turn Log**
${breaker}
**Health Left**:
${state.playerCharacters.map((pc: PlayerCharacter) => pc.name + ': ' + pc.currentHp + '/' + pc.totalHp).join('\n')}
${state.nonPlayerCharacters.map((npc: NonPlayerCharacter) => npc.name + ': ' + npc.currentHp + '/' + npc.totalHp).join('\n')}
${breaker}
Choose your action!!!`

return new MessageEmbed().setColor('#00FFFF')
    .setTitle('Battle!')
    .setDescription(description)
}

function createBattleRow(state:State): MessageActionRow[] {
    const attackButtons: MessageButton[] = []
    const defendButtons: MessageButton[] = []
    const specialButtons: MessageButton[] = []

    const attackItems: Item[] = state.playerCharacters[0].activeItems.filter((item: Item) => {
        return item.actions.filter((action:Action) => {
            return action.actionType.type === ACTION_TYPES.ATTACK
        })
    })
    const defendItems: Item[] = state.playerCharacters[0].activeItems.filter((item: Item) => item.actions.filter((action:Action) => action.actionType.type === ACTION_TYPES.DEFEND))
    const specialItems: Item[] = state.playerCharacters[0].activeItems.filter((item: Item) => item.actions.filter((action:Action) => action.actionType.type === ACTION_TYPES.SPECIAL))

    logger.debug(`
item lengths
Attack Length: ${attackItems.length}
Defend Length: ${defendItems.length}
Special Length: ${specialItems.length}
`)

    attackItems.forEach((item: Item) => {
        item.actions.filter((action: Action) => {
            return action.actionType.type == ACTION_TYPES.ATTACK
        }).forEach((action: Action) => {
            logger.debug(`
Adding Attack Button
Action: ${action.name}
`)
            attackButtons.push(new MessageButton()
                .setStyle('PRIMARY')
                .setCustomId(`battle action ${action.name} ${state.id}`)
                .setLabel(action.name))
        })
    })

    defendItems.forEach((item: Item) => {
        item.actions.filter((action: Action) => {
            return action.actionType.type == ACTION_TYPES.DEFEND
        }).forEach((action: Action) => {
            logger.debug(`
Adding Debug Button
Action: ${action.name}
`)
            defendButtons.push(new MessageButton()
                .setStyle('PRIMARY')
                .setCustomId(`battle action ${action.name} ${state.id}`)
                .setLabel(action.name))
        })
    })

    specialItems.forEach((item: Item) => {
        item.actions.filter((action: Action) => {
            return action.actionType.type == ACTION_TYPES.SPECIAL
        }).forEach((action: Action) => {
            logger.debug(`
Adding Special Button
Action: ${action.name}
`)
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

    const newPlayer: PlayerCharacter = structuredClone(player)
    const newSmole: NonPlayerCharacter = structuredClone(smole)

    newPlayer.currentHp = newPlayer.totalHp
    newSmole.currentHp = newSmole.totalHp

    newPlayer.name = newPlayer.userId
    newSmole.name = 'smole'

    newBattle.playerCharacters.push(newPlayer)
    newBattle.nonPlayerCharacters.push(newSmole)

    logger.debug(`
Starting Battle Between player and smole
Battle ID: ${newBattle.id}
Player ID: ${newBattle.playerCharacters[0].id}
Smole ID: ${newBattle.nonPlayerCharacters[0].id}
`)

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

async function handleAction(interaction: ButtonInteraction, battleID: string) {

    fs.readFile(`./data/battles/${battleID}.json`, 'utf-8', (error, battleFile) => {
        if (error) {
            // logging the error
            logger.error(error);
        
            throw error;
        } else {
            logger.info(`./data/battles/${battleID}.json successfully written`)

            const battle: State = State.fromJSON(JSON.parse(battleFile))
    
            const actionName: string = interaction.customId.split(' ').slice(2,-1).join(' ')      

            definePCIntent(battle, actionName, battle.playerCharacters[0].id, battle.nonPlayerCharacters[0].id)

            const winners = resolveRound(battle)

            const battle_embed: MessageEmbed = createBattleEmbed(battle);
            const battle_rows: MessageActionRow[] = createBattleRow(battle)
    
            interaction.reply({
                embeds: [battle_embed],
                components: battle_rows
            });
        }

        
    })

    
}

export function handleBattleButton(interaction: ButtonInteraction) {
    switch(interaction.customId) {
        case interaction.customId.match(/^battle\sstart/)?.input:
            startBattle(interaction);
            break;
        case interaction.customId.match(/^battle\saction/)?.input:
            const last: number = interaction.customId.split(' ').length - 1
            handleAction(interaction, interaction.customId.split(' ')[last])
            break;
        default:
            logger.error("Unkown Button Pressed");
            logger.error(`Channel - ${interaction.channelId}`);
            logger.error(`User - ${interaction.user.id}`);
    }
}