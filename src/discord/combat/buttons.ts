
import { Interaction, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import Action from "../../types/action";
import logger from "../../util/logger";

export const promptIntent = (actions: Action[]) => {
    // Comes from the response of the command startBattle
    let battle_embed: MessageEmbed = new MessageEmbed()
        .setColor('#00FFFF')
        .setTitle('Choose your action')
        .setDescription(`CHOOSE YOUR ACTIOOOOON`);

    const actionComponents = actions.map((action: Action): MessageButton => {
        return new MessageButton()
            .setCustomId(action.name)
            .setLabel(action.name)
            .setStyle('PRIMARY');
    })

    // const special_button: MessageButton = new MessageButton()
    //     .setCustomId('special')
    //     .setLabel('Special')
    //     .setStyle('PRIMARY');

    const battle_row: MessageActionRow = new MessageActionRow()
        .addComponents(actionComponents);

    async function start_battle(interaction: any) {
        logger.info('Starting Test Battle');
        // initialize battle
        await interaction.reply({
            embeds: [battle_embed],
            components: [battle_row],
            ephemeral: true,
        });
    }
}

export const resolveIntent = (actionType: string) => {
    // what to do with each action type
}

export const resolveRound = () => {
}
