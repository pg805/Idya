import * as readline from 'readline';
import Result_Field from './infrastructure/result_field.js';
import Weapon from './item/weapon.js';
import Player_Character from './character/player_character.js';
import Non_Player_Character from './character/non_player_character.js';
import Pattern from './infrastructure/pattern.js';
import Battle from './combat/battle.js';

/* Human Actions */
const human_defend: number = 7
const human_attack: Result_Field = new Result_Field([0, 3, 4, 5, 5, 5, 6, 8, 10])
const human_special: Result_Field = new Result_Field([5, 10, 10, 20])
const human_shovel: Weapon = new Weapon('Shovel', human_defend, human_attack, human_special)

/* Rat Actions */
const rat_defend: number = 5
const rat_attack: Result_Field = new Result_Field([0, 3, 5, 5, 7, 10])
const rat_special: Result_Field = new Result_Field([3, 9, 15, 15])
const rat_claws: Weapon = new Weapon('Claws', rat_defend, rat_attack, rat_special)

/* Characters */
const human: Player_Character = new Player_Character(
    'Human',
    50,
    human_shovel
)

const rat_pattern: Pattern = new Pattern([1, 2, 3])
const rat: Non_Player_Character = new Non_Player_Character(
    'Rat',
    30,
    rat_pattern,
    rat_claws
)

const test_battle: Battle = new Battle(
    human,
    rat
)

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

while(!test_battle.winner){
    await new Promise((resolve, reject) => rl.question('Player Action? [Defend=1, Attack=2, Special=3] > ', (answer: string) => {
        let winner = ''
        switch(answer.toLowerCase()) {
            case '1':
            case 'defend':
                console.log('Player Defending')
                winner = test_battle.resolve_round(1)
                break;
            case '2':
            case 'attack':
                console.log('Player Attacking')
                winner = test_battle.resolve_round(2)
                break;
            case '3':
            case 'special':
                console.log('Player Specialing')
                winner = test_battle.resolve_round(3)
                break;
            default:
                console.log('Please input 1, 2, or 3')
        }
        if(winner) {
            rl.close()
        }
        resolve(true)
    }))
}

console.log(`
******************************
Winner: ${test_battle.winner}!
`)