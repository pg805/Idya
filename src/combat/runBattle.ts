import { ButtonInteraction } from "discord.js";
import logger from "../util/logger";
import State from "../_store/state";

function startBattle() {

}

export function handleBattleButton(interaction: ButtonInteraction) {
    switch(interaction.customId) {
        case interaction.customId.match(/^battle\sstart/)?.input:

        case interaction.customId.match(/^battle\sattack/)?.input:
        
        case interaction.customId.match(/^battle\sdefend/)?.input:
        
        case interaction.customId.match(/^battle\sspecial/)?.input:

        default:
            logger.error("Unkown Button Pressed");
            logger.error(`Channel - ${interaction.channelId}`);
            logger.error(`User - ${interaction.user.id}`);
    }
}