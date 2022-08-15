import Player from './player';
import Battle_Player from './battle_player';
import Battle from './battle';
import logger from "../util/logger";
import { Interaction, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import { Action, Effect } from './action';
import STATE, { EFFECT } from './constant';

const DEAD: string = "DEAD";
const NONE: string = "NONE";
const DEFEND: string = "DEFEND";
const ATTACK: string = "ATTACK";
const SPECIAL: string = "SPECIAL";

let message: string = '';

let battle_embed: MessageEmbed = new MessageEmbed()
    .setColor('#00FFFF')
    .setTitle('Choose your action')
    .setDescription(`CHOOSE YOUR ACTIOOOOON`);

const attack_button: MessageButton = new MessageButton()
    .setCustomId('attack')
    .setLabel('Attack')
    .setStyle('PRIMARY');

const defend_button: MessageButton = new MessageButton()
    .setCustomId('defend')
    .setLabel('Defend')
    .setStyle('PRIMARY');

const special_button: MessageButton = new MessageButton()
    .setCustomId('special')
    .setLabel('Special')
    .setStyle('PRIMARY');

const battle_row: MessageActionRow = new MessageActionRow()
    .addComponents([attack_button, defend_button, special_button]);

const rat_defend: Action = new Action(STATE.DEFEND);
rat_defend.add_effect(new Effect(0, 0, EFFECT.HEAL));

const rat_attack: Action = new Action(STATE.ATTACK);
rat_attack.add_effect(new Effect(10, 2, EFFECT.DAMAGE));

const rat_special: Action = new Action(STATE.SPECIAL);
rat_special.add_effect(new Effect(30, 1.5, EFFECT.DAMAGE));


const pc_defend: Action = new Action(STATE.DEFEND);
pc_defend.add_effect(new Effect(30, 2, EFFECT.HEAL));

const pc_attack: Action = new Action(STATE.ATTACK);
pc_attack.add_effect(new Effect(30, 2, EFFECT.DAMAGE));

const pc_special: Action = new Action(STATE.SPECIAL);
pc_special.add_effect(new Effect(30, 4, EFFECT.DAMAGE));

const rat: Player = new Player(
    // Name
    'Rat', 
    // Defend
    rat_defend,
    // Attack
    rat_attack,
    // Special
    rat_special
)

const player_character: Player = new Player(
    // name
    'Player Character',
    // Defend
    pc_defend,
    // Attack
    pc_attack,
    // Special
    pc_special
)

const rat_AI = [1, 2];
let rat_move = 0;

const test_battle = new Battle(805);

export async function start_battle(interaction: any) {
    logger.info('Starting Test Battle');
    test_battle.inialize_battle([player_character], [rat]);
    await interaction.reply({
        embeds: [battle_embed],
        components: [battle_row]
    });
}

export async function battle_defend(interaction: any) {
    test_battle.add_defend(player_character, [rat], [player_character]);
    
    if (Math.ceil(Math.random() * 10) == 10) {
        rat_move = Math.floor(Math.random() * 2);
    }

    if (rat_move) {
        logger.info('Rat is specialing');
        test_battle.add_special(rat, [player_character], []);
        rat_move = 0;
    } else {
        logger.info('Rat is attacking');
        test_battle.add_attack(rat, [player_character], []);
        rat_move = 1;
    }

    logger.info('Player is defending, resolving...');

    message = test_battle.resolve();
    battle_embed = battle_embed.setDescription(`${message}\nChoose your action!`);

    logger.info('resolved');

    await interaction.reply({
        embeds: [battle_embed],
        components: [battle_row]
    });
}

export async function battle_attack(interaction: any) {
    test_battle.add_attack(player_character, [rat], []);
    
    if (Math.ceil(Math.random() * 10) == 10) {
        rat_move = Math.floor(Math.random() * 2);
    }

    if (rat_move) {
        logger.info('Rat is specialing');
        test_battle.add_special(rat, [player_character], []);
        rat_move = 0;
    } else {
        logger.info('Rat is attacking');
        test_battle.add_attack(rat, [player_character], []);
        rat_move = 1;
    }

    logger.info('Player is attacking, resolving...');

    message = test_battle.resolve();
    battle_embed = battle_embed.setDescription(`${message}\nChoose your action!`);


    logger.info('resolved');

    await interaction.reply({
        embeds: [battle_embed],
        components: [battle_row]
    });
}

export async function battle_special(interaction: any) {
    test_battle.add_special(player_character, [rat], []);
    
    if (Math.ceil(Math.random() * 10) == 10) {
        rat_move = Math.floor(Math.random() * 2);
    }

    if (rat_move) {
        logger.info('Rat is specialing');
        test_battle.add_special(rat, [player_character], []);
        rat_move = 0;
    } else {
        logger.info('Rat is attacking');
        test_battle.add_attack(rat, [player_character], []);
        rat_move = 1;
    }

    logger.info('Player is specialing, resolving ...');
   
    message = test_battle.resolve();
    battle_embed = battle_embed.setDescription(`${message}\nChoose your action!`);

    logger.info('resolved');

    await interaction.reply({
        embeds: [battle_embed],
        components: [battle_row]
    });
}


