import logger from './utility/logger.js';

import * as readline from 'readline';
import Result_Field from './infrastructure/result_field.js';
import Weapon from './weapon/weapon.js';
import Player_Character from './character/player_character.js';
import Non_Player_Character from './character/non_player_character.js';
import Pattern from './infrastructure/pattern.js';
import Battle from './combat/battle.js';
import Block from './weapon/action/block.js';
import Strike from './weapon/action/strike.js';

/* Rat Weapon - Claws */
const rat_defend = 5;
const rat_block: Block = new Block('Block', '<User> prepares to block for 5 damage.', rat_defend);
const rat_attack: Result_Field = new Result_Field([0, 3, 5, 5, 7, 10]);
const rat_strike: Strike = new Strike('Strike', '<User> scratches <Target> dealing <Damage> damage.', rat_attack);
const rat_special: Result_Field = new Result_Field([3, 9, 15, 15]);
const rat_bite: Strike = new Strike('Bite', '<User> bites <Target> for <Damage> damage.', rat_special);
const rat_claws: Weapon = new Weapon('Claws', [rat_block], [], [rat_strike], [rat_block], [rat_bite], []);

/* Characters */
let human: Player_Character = new Player_Character(
    'Human',
    50,
    Weapon.from_json('./database/weapons/shovel.json')
);

const rat_pattern: Pattern = new Pattern([1, 2, 3]);
const rat: Non_Player_Character = new Non_Player_Character(
    'Rat',
    30,
    rat_pattern,
    rat_claws
);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

await new Promise((resolve, reject) => rl.question('Choose your weapon! [Shovel=1, Deck of Cards=2, Paint Can=3, Awakened Mind=4, Vines and Thorns=5] > ', (answer: string) => {
    switch (answer.toLowerCase()) {
        case '1':
        case 'shovel':
            logger.info('Shovel Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_json('./database/weapons/shovel.json')
            );
            break;
        case '2':
        case 'deck of cards':
            logger.info('Deck of Cards Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_json('./database/weapons/deck_of_cards.json')
            );
            break;
        case '3':
        case 'paint can':
            logger.info('Paint Can Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_json('./database/weapons/can_of_paint.json')
            );
            break;
        case '4':
        case 'awakened mind':
        case 'brain':
            logger.info('Awakened Mind Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_json('./database/weapons/awakened_mind.json')
            );
            break;
        case '5':
        case 'vine':
        case 'thorn':
        case 'vines and thorns':
            logger.info('Vines and Thorns Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_json('./database/weapons/vine_and_thorn.json')
            );
            break;
        default:
            logger.info('Please input a weapon or weapon number.');
    }

    resolve(true);
}));

const test_battle: Battle = new Battle(
    human,
    rat
);

while (!test_battle.winner) {
    await new Promise((resolve, reject) => rl.question('Player Action? [Defend=1, Attack=2, Special=3] > ', (answer: string) => {
        let round_object:  {
            action_string: string,
            winner: string
        };
        switch (answer.toLowerCase()) {
            case '1':
            case 'defend':
                logger.info('Player Defending');
                round_object = test_battle.resolve_round(1);
                break;
            case '2':
            case 'attack':
                logger.info('Player Attacking');
                round_object = test_battle.resolve_round(2);
                break;
            case '3':
            case 'special':
                logger.info('Player Specialing');
                round_object = test_battle.resolve_round(3);
                break;
            default:
                round_object = {
                    action_string: 'Invalid Input',
                    winner: ''
                }
                logger.info('Please input 1, 2, or 3');
        }

        const winner: string = round_object.winner
        const action_string: string = round_object.action_string

        logger.info(action_string)

        if (winner) {
            rl.close();
        }
        resolve(true);
    }));
}

logger.info(`******************************
Winner: ${test_battle.winner}!`);
