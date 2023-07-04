// library dependencies
import { handleBattleButton } from '../combat/runBattle.js';
import logger from '../util/logger.js';
import { ButtonInteraction } from 'discord.js'

export function handleButtonPress(interaction: ButtonInteraction) {
    logger.debug(`
Handling Button
Custom ID: ${interaction.customId}
Guild ID: ${interaction.guildId}
Channel ID: ${interaction.channelId}
`)
    switch(interaction.customId) {
        case interaction.customId.match(/^battle\s.+/)?.input:
            handleBattleButton(interaction)
            break;
        default:
            logger.error("Unkown Button Pressed");
            logger.error(`Channel - ${interaction.channelId}`);
            logger.error(`User - ${interaction.user.id}`);
    }
}