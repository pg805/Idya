import logger from './utility/logger.js';

import * as readline from 'readline';
import Weapon from './weapon/weapon.js';
import Player_Character from './character/player_character.js';
import Non_Player_Character from './character/non_player_character.js';
import Battle from './combat/battle.js';

const human_image = 'https://cdn.discordapp.com/attachments/1258456865881194586/1341942313601204244/Asterius_with_Background_-_Big.png?ex=67b7d4ab&is=67b6832b&hm=e0f2f414fbf23dcca89969b37b6477e96049df1b142ea32feea0316e3f73c270&'

/* Characters */
let human: Player_Character = new Player_Character(
    'Human',
    50,
    Weapon.from_file('./database/weapons/shovel.yaml'),
    human_image
);

let enemy: Non_Player_Character = Non_Player_Character.from_file('./database/enemies/rat.yaml')

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
                Weapon.from_file('./database/weapons/shovel.yaml'),
                human_image
            );
            break;
        case '2':
        case 'deck of cards':
            logger.info('Deck of Cards Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_file('./database/weapons/deck_of_cards.yaml'),
                human_image
            );
            break;
        case '3':
        case 'paint can':
            logger.info('Paint Can Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_file('./database/weapons/can_of_paint.yaml'),
                human_image
            );
            break;
        case '4':
        case 'awakened mind':
        case 'brain':
            logger.info('Awakened Mind Chosen as weapon!');
            human = new Player_Character(
                'Human',
                50,
                Weapon.from_file('./database/weapons/awakened_mind.yaml'),
                human_image
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
                Weapon.from_file('./database/weapons/vine_and_thorn.yaml'),
                human_image
            );
            break;
        default:
            logger.info('Please input a weapon or weapon number.');
    }

    resolve(true);
}));

await new Promise((resolve, reject) => rl.question('Choose your Enemy! [Rat=1, Zombie=2, Mushroom=3] > ', (answer: string) => {
    switch (answer.toLowerCase()) {
        case '1':
        case 'rat':
            logger.info('Rat Chosen as enemy!');
            enemy = Non_Player_Character.from_file('./database/enemies/rat.yaml')
            break;
        case '2':
        case 'zombie':
            logger.info('Zombie Chosen as enemy!');
            enemy = Non_Player_Character.from_file('./database/enemies/zombie.yaml')
            break;
        case '3':
        case 'mushroom':
            logger.info('Mushroom Chosen as enemy!');
            enemy = Non_Player_Character.from_file('./database/enemies/mushroom.yaml')
            break;
        default:
            logger.info('Please input an enemy or enemy number.');
    }

    resolve(true);
}));

const test_battle: Battle = new Battle(
    human,
    enemy
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

logger.debug(`Full Log:\n${test_battle.log.join('\n')}`)

logger.info(`******************************
Winner: ${test_battle.winner}!`);
