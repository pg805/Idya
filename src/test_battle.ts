import * as readline from 'readline';
import Result_Field from './infrastructure/result_field.js';
import Weapon from './weapon/weapon.js';
import Player_Character from './character/player_character.js';
import Non_Player_Character from './character/non_player_character.js';
import Pattern from './infrastructure/pattern.js';
import Battle from './combat/battle.js';
import Block from './weapon/action/block.js';
import Strike from './weapon/action/strike.js';
import Debuff from './weapon/action/debuff.js';
import Heal from './weapon/action/heal.js';
import Damage_Over_Time from './weapon/action/damage_over_time.js';
import Shield from './weapon/action/shield.js';

/* Human Weapon - Shovel */
const human_defend: number = 10
const human_block: Block = new Block('Block', human_defend)
const human_attack: Result_Field = new Result_Field([0, 3, 4, 5, 5, 5, 5, 6, 8, 10])
const human_strike: Strike = new Strike('Strike', human_attack)
const human_special: Result_Field = new Result_Field([5, 10, 10, 20])
const human_charge: Strike = new Strike('Charge', human_special)
const human_shovel: Weapon = new Weapon('Shovel', [human_block], [], [human_strike], [human_block], [human_charge], [])

/* Human Weapon - Cards */
const card_defend: number = 4
const card_block: Block = new Block('Block', card_defend)
const card_attack: Result_Field = new Result_Field([2,3,4,5,6,7,8,9,10,10,10,10,11])
const card_attack_crit: number = 6
const card_attack_crit_rounds: number = 2
const card_strike: Strike = new Strike('Rank', card_attack)
const card_attack_crit_strike: Debuff = new Debuff('Joker', card_attack_crit, card_attack_crit_rounds)
const card_special: Result_Field = new Result_Field([1, 12, 17, 22])
const card_suit: Strike = new Strike('Suit', card_special)
const human_cards: Weapon = new Weapon('Deck of Cards', [card_block], [], [card_strike], [card_attack_crit_strike], [card_suit], [])

/* Human Weapon - Paint */
const paint_heal: number = 7
const paint_refill: Heal = new Heal('Mix Paint', paint_heal)
const paint_defend: number = 2
const paint_block: Block = new Block('Paint Can', paint_defend)

const paint_attack: Result_Field = new Result_Field([0, 7, 7, 7])
const paint_coat: Strike = new Strike('Paint Coat', paint_attack)
const paint_attack_crit: number = 7
const paint_attack_crit_rounds: number = 2
const paint_blind: Shield = new Shield('Blind', paint_attack_crit, paint_attack_crit_rounds)

const paint_special: Result_Field = new Result_Field([2, 3, 5, 7])
const paint_special_rounds: number = 3
const paint_dry: Damage_Over_Time = new Damage_Over_Time('Paint Dry', paint_special, paint_special_rounds)

const human_paint: Weapon = new Weapon('Paint Can', [paint_refill, paint_block], [], [paint_coat], [paint_blind], [paint_dry], [])

/* Human Weapon - Awakened Mind */

/* Human Weapon - Vines and Thorns */

/* Rat Weapon - Claws */
const rat_defend: number = 5
const rat_block: Block = new Block('Block', rat_defend)
const rat_attack: Result_Field = new Result_Field([0, 3, 5, 5, 7, 10])
const rat_strike: Strike = new Strike('Strike', rat_attack)
const rat_special: Result_Field = new Result_Field([3, 9, 15, 15])
const rat_bite: Strike = new Strike('Bite', rat_special)
const rat_claws: Weapon = new Weapon('Claws', [rat_block], [], [rat_strike], [rat_block], [rat_bite], [])

/* Characters */
let human: Player_Character = new Player_Character(
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

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let weapon = 0
await new Promise((resolve, reject) => rl.question('Choose your weapon! [Shovel=1, Deck of Cards=2] >', (answer: string) => {
    switch(answer.toLowerCase()) {
        case '1':
        case 'shovel':
            console.log('Shovel Chosen as weapon!')
            human = new Player_Character(
                'Human',
                50,
                human_shovel
            )
            break;
        case '2':
        case 'deck of cards':
            console.log('Deck of Cards Chosen as weapon!')
            human = new Player_Character(
                'Human',
                50,
                human_cards
            )
            break;
        case '3':
        case 'paint can':
            console.log('Paint Can Chosen as weapon!')
            human = new Player_Character(
                'Human',
                50,
                human_paint
            )
            break;
        default:
            console.log('Please input a weapon or weapon number.')
    }

    resolve(true)
}))

const test_battle: Battle = new Battle(
    human,
    rat
)

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