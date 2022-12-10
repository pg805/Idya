import PlayerCharacter from "../../types/character/playerCharacter";
import { promptIntent } from "./buttons";

export const promptUser = (user: PlayerCharacter) => {
    promptIntent(user.getActiveActions())

}