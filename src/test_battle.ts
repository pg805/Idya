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
import Buff from './weapon/action/buff.js';
import Reflect from './weapon/action/reflect.js';

/* Human Weapon - Shovel */
const human_shovel = Weapon.from_json('./database/weapons/shovel.json')

/* Human Weapon - Cards */
const human_cards: Weapon = Weapon.from_json('./database/weapons/deck_of_cards.json')

/* Human Weapon - Paint */
const human_paint = Weapon.from_json('./database/weapons/can_of_paint.json')

/* Human Weapon - Awakened Mind */
const human_awakened_mind = Weapon.from_json('./database/weapons/awakened_mind.json')

/* Human Weapon - Vines and Thorns */
const vine_reflect: number = 5
const vine_reflect_rounds: number = 3
const vine_thorn: Reflect = new Reflect('Thorns', vine_reflect, vine_reflect_rounds)

const vine_block: number = 5
const vine_block_rounds: number = 3
const vine_trunk: Shield = new Shield('Trunk', vine_block, vine_block_rounds)

const vine_attack: Result_Field = new Result_Field([0, 2, 2, 3, 4, 5])
const vine_branch: Strike = new Strike('Branch', vine_attack)

const vine_attack_crit: number = 5
const vine_grow: Heal = new Heal('Grow', vine_attack_crit)

const vine_special: Result_Field = new Result_Field([1, 3])
const vine_special_rounds: number = 3
const vine_constrict: Damage_Over_Time = new Damage_Over_Time('Constrict', vine_special, vine_special_rounds)

const human_vine_and_thorn: Weapon = new Weapon('Vines and Thorn', [vine_thorn, vine_trunk], [], [vine_branch], [vine_grow], [vine_constrict], [])

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

await new Promise((resolve, reject) => rl.question('Choose your weapon! [Shovel=1, Deck of Cards=2, Paint Can=3, Awakened Mind=4, Vines and Thorns=5] > ', (answer: string) => {
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
        case '4':
        case 'awakened mind':
        case 'brain':
            console.log('Awakened Mind Chosen as weapon!')
            human = new Player_Character(
                'Human',
                50,
                human_awakened_mind
            )
            break;
        case '5':
        case 'vine':
        case 'thorn':
        case 'vines and thorns':
            console.log('Vines and Thorns Chosen as weapon!')
            human = new Player_Character(
                'Human',
                50,
                human_vine_and_thorn
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

console.log(`******************************
Winner: ${test_battle.winner}!`)