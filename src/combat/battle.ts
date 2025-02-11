import Player_Character from "../character/player_character.js";
import Non_Player_Character from "../character/non_player_character.js";

export default class Battle {
    player_character: Player_Character
    non_player_character: Non_Player_Character
    pc_health: number;
    npc_health: number;
    npc_index: number = 0;
    current_round: number = 1;
    complete:boolean = false;
    winner: string = '';

    constructor(player_character: Player_Character, non_player_character: Non_Player_Character) {
        this.player_character = player_character
        this.non_player_character = non_player_character
        this.pc_health = player_character.health
        this.npc_health = non_player_character.health
    }

    check_winners() {
        // Specify Tie
        if(this.pc_health == 0 && this.npc_health == 0) {
            return this.non_player_character.name
        }

        // NPC Win
        if(this.pc_health == 0) {
            return this.non_player_character.name
        }

        // PC Win
        if(this.npc_health == 0) {
            return this.player_character.name
        }

        return ""
    }

    resolve_round(player_action: number) {
        const npc_action: number = this.non_player_character.pattern.field[this.npc_index]
        console.log(
`***************************
Resolving Turn
Current Round: ${this.current_round}
Player Health: ${this.pc_health}
Non Player Health: ${this.npc_health}
Player Action: ${player_action}
Non Player Character Action: ${npc_action}
`
        )

        // Player Attack
        if(player_action == 2) {
            const player_roll = this.player_character.weapon.attack.get_result()

            let damage = 0
            if(npc_action == 1) {
                damage = Math.max(player_roll - this.non_player_character.weapon.defend, 0)
            } else {
                damage = player_roll
            }

            this.npc_health = Math.max(this.npc_health - damage, 0)

            console.log(
`
Resolving Player Attack
Player Roll: ${player_roll}
Damage: ${damage}
Updated Health: ${this.npc_health}
`
            )
        }

        // Non Player Attack
        if(npc_action == 2) {
            const non_player_roll = this.non_player_character.weapon.attack.get_result()

            let damage = 0
            if(player_action == 1) {
                damage = Math.max(non_player_roll - this.non_player_character.weapon.defend, 0)
            } else {
                damage = non_player_roll
            }

            this.pc_health = Math.max(this.pc_health - damage, 0)

            console.log(
`
Resolving Non Player Attack
Non Player Roll: ${non_player_roll}
Damage: ${damage}
Updated Health: ${this.pc_health}
`
            )
        }

        // Check For Winners
        this.winner = this.check_winners()
        if(this.winner) {
            return this.winner
        }

        // Player Special
        if(player_action == 3) {
            const player_roll = this.player_character.weapon.special.get_result()

            // TODO: Special Defense
            const damage = player_roll

            this.npc_health = Math.max(this.npc_health - damage, 0)

            console.log(
`
Resolving Player Special
Player Roll: ${player_roll}
Damage: ${damage}
Updated Health: ${this.npc_health}
`
            )
        }

        // Non Player Special
        if(npc_action == 3) {
            const non_player_roll = this.non_player_character.weapon.special.get_result()

            // TODO: Special Defense
            const damage = non_player_roll

            this.pc_health = Math.max(this.pc_health - damage, 0)

            console.log(
`
Resolving Non Player Special
Non Player Roll: ${non_player_roll}
Damage: ${damage}
Updated Health: ${this.pc_health}
`
            )
        }

        // Check For Winners
        this.winner = this.check_winners()

        // Round End Updating
        this.current_round += 1
        this.npc_index = (this.npc_index + 1) % this.non_player_character.pattern.length

        return this.winner
    }
}