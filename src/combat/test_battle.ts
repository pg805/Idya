import Player from './player';
import Battle_Player from './battle_player';
import Battle from './battle';

const DEAD: string = "DEAD";
const NONE: string = "NONE";
const DEFEND: string = "DEFEND";
const ATTACK: string = "ATTACK";
const SPECIAL: string = "SPECIAL";

const rat: Player = new Player(
    // Name
    'Rat', 
    // Defend
    (rat: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) => {
        return;
    },
    // Attack
    (rat: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) => {
        // Bite
        const damage: number = Math.ceil(Math.random() * 10);

        if(damage_targets[0].battle_status == SPECIAL){
            damage_targets[0].health -= (damage * 2);
        } else {
            damage_targets[0].health -= damage;
        } 
    },
    // Special
    (rat: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) => {
        const damage: number = Math.ceil(Math.random() * 30);

        if(damage_targets[0].battle_status == DEFEND){
            damage_targets[0].health -= (damage * 1.5);
        } else {
            damage_targets[0].health -= damage;
        } 
    }
)

const player_character: Player = new Player(
    // name
    'Player Character',
    // Defend
    (player_character: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) => {
        // Will just be a heal for now
        const heal: number = Math.ceil(Math.random() * 30);

        if(damage_targets[0].battle_status == ATTACK) {
            player_character.health += (heal * 2);
        } else {
            player_character.health += heal;
        }

        return;
    },
    // Attack
    (rat: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) => {
        // Will just be a heal for now
        const damage: number = Math.ceil(Math.random() * 30);

        if(damage_targets[0].battle_status == SPECIAL) {
            damage_targets[0].health -= (damage * 2);
        } else {
            damage_targets[0].health -= damage;
        }

        return;
    },
    // Special
    (rat: Battle_Player, damage_targets: Array<Battle_Player>, heal_targets: Array<Battle_Player>) => {
        // Will just be a heal for now
        const damage: number = Math.ceil(Math.random() * 30);

        if(damage_targets[0].battle_status == DEFEND) {
            damage_targets[0].health -= (damage * 4);
        } else {
            damage_targets[0].health -= damage;
        }

        return;
    }
)

const test_battle = new Battle(805);

test_battle.inialize_battle([player_character], [rat]);

