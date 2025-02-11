import * as readline from 'readline';
import Result_Field from './infrastructure/result_field.js';
import Weapon from './weapon/weapon.js';
import Player_Character from './character/player_character.js';
import Non_Player_Character from './character/non_player_character.js';
import Pattern from './infrastructure/pattern.js';
import Battle from './combat/battle.js';
import Block from './weapon/action/block.js';
import Strike from './weapon/action/strike.js';

/* Human Weapon - Shovel */
const human_defend: number = 7
const human_block: Block = new Block('Block', human_defend)
const human_attack: Result_Field = new Result_Field([0, 3, 4, 5, 5, 5, 6, 8, 10])
const human_strike: Strike = new Strike('Strike', human_attack)
const human_special: Result_Field = new Result_Field([5, 10, 10, 20])
const human_charge: Strike = new Strike('Charge', human_special)
const human_shovel: Weapon = new Weapon('Shovel', [human_block], [human_strike], [human_charge])

/* Rat Actions */
const rat_defend: number = 5
const rat_block: Block = new Block('Block', rat_defend)
const rat_attack: Result_Field = new Result_Field([0, 3, 5, 5, 7, 10])
const rat_strike: Strike = new Strike('Strike', rat_attack)
const rat_special: Result_Field = new Result_Field([3, 9, 15, 15])
const rat_bite: Strike = new Strike('Bite', rat_special)
const rat_claws: Weapon = new Weapon('Claws', [rat_block], [rat_strike], [rat_bite])

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
Winner: ${test_battle.winner}!`)