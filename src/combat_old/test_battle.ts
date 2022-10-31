import Player from './player';
import Battle_Player from './battle_player';
import Battle from './battle';
import logger from "../util/logger";
import { Interaction, MessageActionRow, MessageButton, MessageEmbed } from "discord.js";
import { Action, Heal_Effect, Damage_Effect, Effect_Group, Status_Effect, Effect } from './action';
import { STATE, EFFECT, TARGET_REQ } from './constant';
import { Group_Target, Numbered_Target, Self_Target, Target_Group } from './target_group';
import { group } from 'console';
import { Damage_Reduction_Status, Damage_Status } from './status';
import { Status } from './status';

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
    .addComponents([defend_button, attack_button, special_button]);

const smole_defend: Action = new Action(STATE.DEFEND);
const smole_attack: Action = new Action(STATE.ATTACK);
const smole_special: Action = new Action(STATE.SPECIAL);

const pc_defend: Action = new Action(STATE.DEFEND);
const pc_attack: Action = new Action(STATE.ATTACK);
const pc_special: Action = new Action(STATE.SPECIAL);

if(2) {
    // smole defend
    const smole_defend_group: Effect_Group = new Effect_Group(TARGET_REQ.SELF);
    const smole_defend_template = Effect.create_template`${'user'} ${'crit'} heals himself for ${'amount'} by eating some moldy cheese.`;
    smole_defend_group.add_effect(new Heal_Effect(0, 0, 0, smole_defend_template));
    smole_defend.add_effect(smole_defend_group);
    
    // smole attack with poison
    const smole_poison_status_template = Status.create_template`The poison courses through ${'user'}'s veins for ${'amount'}`;
    const smole_poison = new Damage_Status(2, 10, 'poison', smole_poison_status_template);

    const smole_attack_group: Effect_Group = new Effect_Group("1");
    const smole_attack_template = Effect.create_template`${'user'} ${'crit'} bites ${'target'} for ${'amount'}.`
    smole_attack_group.add_effect(new Damage_Effect(10, 0, 2, smole_attack_template));
    const smole_poison_template = Effect.create_template`${'user'} ${'crit'} poisons ${'target'} for ${'amount'}.`
    smole_attack_group.add_effect(new Status_Effect(smole_poison, 2, smole_poison_template));
    smole_attack.add_effect(smole_attack_group);
    
    // smole special
    const smole_special_group: Effect_Group = new Effect_Group("1");
    const smole_special_template = Effect.create_template`${'user'} whips its tail around, ${'crit'} hitting ${'target'} for ${'amount'}.`
    smole_special_group.add_effect(new Damage_Effect(30, 0, 1.5, smole_special_template));
    smole_special.add_effect(smole_special_group);

    // PC defend with damage reduction
    const shield_block_template = Status.create_template`${'user'} holds up their shield, protecting for ${'amount'}`;
    const shield_block = new Damage_Reduction_Status(1, 30, 'shield', TARGET_REQ.SELF, shield_block_template);

    const pc_defend_group: Effect_Group = new Effect_Group(TARGET_REQ.SELF);
    const pc_defend_template = Effect.create_template`${'user'} begins chanting a soothing song and ${'crit'} heals ${'target'} for ${'amount'}`;
    pc_defend_group.add_effect(new Heal_Effect(30, 10, 2, pc_defend_template));
    const pc_shield_template = Effect.create_template`${'user'} puts up his shield, ${'crit'} protecting himself for ${'amount'} damage`;
    pc_defend_group.add_effect(new Status_Effect(shield_block, 2, pc_shield_template));
    pc_defend.add_effect(pc_defend_group);
    
    // PC attack
    const pc_attack_group: Effect_Group = new Effect_Group("1");
    const pc_attack_template = Effect.create_template`${'user'} ${'crit'} slashes at ${'target'} for ${'amount'} damage`;
    pc_attack_group.add_effect(new Damage_Effect(30, 10, 2, pc_attack_template));
    pc_attack.add_effect(pc_attack_group);
    
    // PC special
    const pc_special_group: Effect_Group = new Effect_Group("1");
    const pc_special_template = Effect.create_template`${'user'} shoots a frostbolt at ${'target'}, ${'crit'} hitting them for ${'amount'} damage`;
    pc_special_group.add_effect(new Damage_Effect(30, 10, 4, pc_special_template));
    pc_special.add_effect(pc_special_group);

} else {
    const smole_defend_group: Effect_Group = new Effect_Group(TARGET_REQ.SELF);
    const smole_defend_template = Effect.create_template`${'user'} ${'crit'} heals himself for ${'amount'} by eating some moldy cheese.`;
    smole_defend_group.add_effect(new Heal_Effect(0, 0, 0, smole_defend_template));
    smole_defend.add_effect(smole_defend_group);
    
    const smole_attack_group: Effect_Group = new Effect_Group("1");
    const smole_attack_template = Effect.create_template`${'user'} ${'crit'} bites ${'target'} for ${'amount'}.`
    smole_attack_group.add_effect(new Damage_Effect(10, 0, 2, smole_attack_template));
    smole_attack.add_effect(smole_attack_group);
    
    const smole_special_group: Effect_Group = new Effect_Group("1");
    const smole_special_template = Effect.create_template`${'user'} whips its tail around, ${'crit'} hitting ${'target'} for ${'amount'}.`
    smole_special_group.add_effect(new Damage_Effect(30, 0, 1.5, smole_special_template));
    smole_special.add_effect(smole_special_group);
    
    const pc_defend_group: Effect_Group = new Effect_Group(TARGET_REQ.SELF);
    const pc_defend_template = Effect.create_template`${'user'} begins chanting a soothing song and ${'crit'} heals ${'target'} for ${'amount'}`;
    pc_defend_group.add_effect(new Heal_Effect(30, 10, 2, pc_defend_template));
    pc_defend.add_effect(pc_defend_group);

    const pc_attack_group: Effect_Group = new Effect_Group("1");
    const pc_attack_template = Effect.create_template`${'user'} ${'crit'} slashes at ${'target'} for ${'amount'} damage`;
    pc_attack_group.add_effect(new Damage_Effect(30, 10, 2, pc_attack_template));
    pc_attack.add_effect(pc_attack_group);

    const pc_special_group: Effect_Group = new Effect_Group("1");
    const pc_special_template = Effect.create_template`${'user'} shoots a frostbolt at ${'target'}, ${'crit'} hitting them for ${'amount'} damage`;
    pc_special_group.add_effect(new Damage_Effect(30, 10, 4, pc_special_template));
    pc_special.add_effect(pc_special_group);
}
    
    const smole: Player = new Player(
    // Name
    'Smole', 
    // Defend
    smole_defend,
    // Attack
    smole_attack,
    // Special
    smole_special
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

const smole_AI = [1, 2];
let smole_move = 0;

const test_battle = new Battle(805);

export async function start_battle(interaction: any) {
    logger.info('Starting Test Battle');
    test_battle.inialize_battle([player_character], [smole]);
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
        smole_move = Math.floor(Math.random() * 2);
    }
    
    if (smole_move) {
        logger.info('Smole is specialing');
        const smole_group = new Numbered_Target(smole.special.action_list[0].effects, 1);
        // @ts-ignore: accessing commands
        smole_group.add_target(test_battle.self_target(player_character))
        // @ts-ignore: accessing commands
        test_battle.add_action(smole, [smole_group], STATE.SPECIAL);
        smole_move = 0;
    } else {
        logger.info('Smole is attacking');
        const smole_group = new Numbered_Target(smole.attack.action_list[0].effects, 1);
        // @ts-ignore: accessing commands
        smole_group.add_target(test_battle.self_target(player_character))
        // @ts-ignore: accessing commands
        test_battle.add_action(smole, [smole_group], STATE.ATTACK);
        smole_move = 1;
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



