import Player from './player';
import Battle_Player from './battle_player';
import Battle from './battle';
import logger from "../util/logger";
import { Interaction, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";

const DEAD: string = "DEAD";
const NONE: string = "NONE";
const DEFEND: string = "DEFEND";
const ATTACK: string = "ATTACK";
const SPECIAL: string = "SPECIAL";

let message: string = '';

const battle_embed: MessageEmbed = new MessageEmbed()
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
    test_battle.add_defend(player_character, [rat], []);
    
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
    battle_embed.setDescription(message);

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
    battle_embed.setDescription(message);


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
    battle_embed.setDescription(message);

    logger.info('resolved');

    await interaction.reply({
        embeds: [battle_embed],
        components: [battle_row]
    });
}


