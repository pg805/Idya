import Player from './player';
import Battle_Player from './battle_player';
import Battle from './battle';
import logger from "../util/logger";
import { Interaction, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import { Action, Heal_Effect, Damage_Effect, Effect_Group } from './action';
import { STATE, EFFECT, TARGET_REQ } from './constant';
import { Group_Target, Numbered_Target, Self_Target, Target_Group } from './target_group';
import { group } from 'console';

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
const rat_defend_group: Effect_Group = new Effect_Group(TARGET_REQ.SELF);
rat_defend_group.add_effect(new Heal_Effect(0, 0, 0));
rat_defend.add_effect(rat_defend_group);

const rat_attack: Action = new Action(STATE.ATTACK);
const rat_attack_group: Effect_Group = new Effect_Group("1");
rat_attack_group.add_effect(new Damage_Effect(10, 0, 2));
rat_attack.add_effect(rat_attack_group);

const rat_special: Action = new Action(STATE.SPECIAL);
const rat_special_group: Effect_Group = new Effect_Group("1");
rat_special_group.add_effect(new Damage_Effect(30, 0, 1.5));
rat_special.add_effect(rat_special_group);

const pc_defend: Action = new Action(STATE.DEFEND);
const pc_defend_group: Effect_Group = new Effect_Group(TARGET_REQ.SELF);
pc_defend_group.add_effect(new Heal_Effect(30, 10, 2));
pc_defend.add_effect(pc_defend_group);

const pc_attack: Action = new Action(STATE.ATTACK);
const pc_attack_group: Effect_Group = new Effect_Group("1");
pc_attack_group.add_effect(new Damage_Effect(30, 10, 2));
pc_attack.add_effect(pc_attack_group);

const pc_special: Action = new Action(STATE.SPECIAL);
const pc_special_group: Effect_Group = new Effect_Group("1");
pc_special_group.add_effect(new Damage_Effect(30, 10, 4));
pc_special.add_effect(pc_special_group);

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

// function create_target_group(effect_group: Effect_Group, user: Player) {
//     switch(effect_group.target_req) {
//         case TARGET_REQ.SELF:
//             // should probably change this
//             // @ts-ignore: accessing commands
//             return new Self_Target(effect_group.effects, test_battle.self_target(user));
//             break;
//         case TARGET_REQ.ALL:
//             // @ts-ignore: accessing commands
//             return new Group_Target(effect_group.effects, effect_group.target_req, test_battle.all())
//             break;
//         case TARGET_REQ.ALLIES:
//             // @ts-ignore: accessing commands
//             return new Group_Target(effect_group.effects, effect_group.target_req, test_battle.all_allies())
//         case TARGET_REQ.ENEMIES:
//             // @ts-ignore: accessing commands
//             const group = new Group_Target(effect_group.effects, effect_group.target_req, test_battle.all_enemies(user))
//         case TARGET_REQ.OTHERS:
//             // @ts-ignore: accessing commands
//             const group = new Group_Target(effect_group.effects, effect_group.target_req, test_battle.all_others(user))
//         default:
//             if(parseInt(effect_group.target_req)) {
//                 // put a loop here or something
//                 // @ts-ignore: accessing commands
//                 const group = new Group_Target(effect_group.effects, effect_group.target_req, test_battle.all_enemies(user))
//             } else {
//                 logger.warn(`${effect_group.target_req} is not a real target requirement :(`);
//             }
//     }

//     return group;
// }

export async function battle_action(interaction: any, type: string) {

    logger.debug(`${type} selected for Player Character`)
    const groups: Array<Target_Group> = [];

    if(type == STATE.DEFEND) {
        logger.debug('Made it to Defend');
        // @ts-ignore: accessing commands
        groups.push(new Self_Target(player_character.defend.action_list[0].effects, test_battle.self_target(player_character)));
    } else if (type == STATE.ATTACK) {
        logger.debug('Made it to Attack');
        // @ts-ignore: accessing commands
        groups.push(new Group_Target(player_character.attack.action_list[0].effects, player_character.attack.action_list[0].target_req, test_battle.all_enemies(player_character)));
    } else {
        logger.debug('Made it to Special');
        // @ts-ignore: accessing commands
        groups.push(new Group_Target(player_character.special.action_list[0].effects, player_character.special.action_list[0].target_req, test_battle.all_enemies(player_character)));
    }

    test_battle.add_action(player_character, groups, type);

    if (Math.ceil(Math.random() * 10) == 10) {
        rat_move = Math.floor(Math.random() * 2);
    }
    
    if (rat_move) {
        logger.info('Rat is specialing');
        const rat_group = new Numbered_Target(rat.special.action_list[0].effects, 1);
        // @ts-ignore: accessing commands
        rat_group.add_target(test_battle.self_target(player_character))
        // @ts-ignore: accessing commands
        test_battle.add_action(rat, [rat_group], STATE.SPECIAL);
        rat_move = 0;
    } else {
        logger.info('Rat is attacking');
        const rat_group = new Numbered_Target(rat.attack.action_list[0].effects, 1);
        // @ts-ignore: accessing commands
        rat_group.add_target(test_battle.self_target(player_character))
        // @ts-ignore: accessing commands
        test_battle.add_action(rat, [rat_group], STATE.ATTACK);
        rat_move = 1;
    }

    logger.info(`Player is ${type}ing, resolving...`);

    message = test_battle.resolve();
    battle_embed = battle_embed.setDescription(`${message}\nChoose your action!`);

    logger.info('resolved');

    await interaction.reply({
        embeds: [battle_embed],
        components: [battle_row]
    });
}



