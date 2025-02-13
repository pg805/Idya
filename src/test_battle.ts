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
const brain_buff: number = 5
const brain_buff_rounds: number = 3
const brain_control_stone: Buff = new Buff('Control Stone', brain_buff, brain_buff_rounds)
const brain_block: number = 5
const brain_stone_block: Block = new Block('Stone Block', brain_block)

const brain_attack: Result_Field = new Result_Field([1,1,1,2,3,4])
const brain_hurl_rock: Strike = new Strike('Hurl Rock', brain_attack)
const brain_attack_crit: Result_Field = new Result_Field([2, 4, 6, 8])
const brain_attack_crit_rounds: number = 2
const brain_depress: Damage_Over_Time = new Damage_Over_Time('Depress', brain_attack_crit, brain_attack_crit_rounds)

const brain_debuff: number = 8
const brain_debuff_rounds: number = 4 
const brain_distract: Debuff = new Debuff('Distract', brain_debuff, brain_debuff_rounds)

const human_awakened_mind: Weapon = new Weapon('Awakened Mind', [brain_control_stone, brain_stone_block], [], [brain_hurl_rock], [brain_depress], [brain_distract], [])

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

let weapon = 0
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

console.log(`
******************************
Winner: ${test_battle.winner}!`)