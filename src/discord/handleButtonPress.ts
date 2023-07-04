// library dependencies
import logger from '../util/logger.js';
import { ButtonInteraction } from 'discord.js'

export function handleButtonPress(interaction: ButtonInteraction) {
    switch(interaction.customId) {
        case interaction.customId.match(/^battle\s.+/)?.input:
            break;
        default:
            logger.error("Unkown Button Pressed");
            logger.error(`Channel - ${interaction.channelId}`);
            logger.error(`User - ${interaction.user.id}`);
    }
}