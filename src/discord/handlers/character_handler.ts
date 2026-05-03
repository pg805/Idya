import {
    ActionRowBuilder,
    bold,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import fs from 'fs';
import yaml from 'js-yaml';
import CharacterRepository from '../../character/character_repository.js';
import Weapon from '../../weapon/weapon.js';
import Action from '../../weapon/action.js';
import logger from '../../utility/logger.js';

interface WeaponOption {
    key: string;
    name: string;
    description: string;
}

function load_weapon_options(): WeaponOption[] {
    const weapons_dir = './database/weapons';
    return fs.readdirSync(weapons_dir)
        .filter(f => f.endsWith('.yaml'))
        .map(f => {
            const data = yaml.load(fs.readFileSync(`${weapons_dir}/${f}`, 'utf-8')) as { Name: string; Description: string };
            return {
                key: f.replace('.yaml', ''),
                name: data.Name,
                description: data.Description.substring(0, 100)
            };
        });
}

const weapon_options = load_weapon_options();

function build_weapon_select_components(): { embeds: EmbedBuilder[], components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
    const embed = new EmbedBuilder()
        .setColor(0x00FFFF)
        .setTitle('Choose Your Weapon')
        .setDescription('Select a weapon to carry into battle. Choose wisely — this is what you\'ll rely on to survive!')
        .addFields(weapon_options.map(w => ({ name: w.name, value: w.description, inline: true })));

    const menu = new StringSelectMenuBuilder()
        .setCustomId('CreateCharWeaponSelect')
        .setPlaceholder('Pick a weapon...')
        .addOptions(weapon_options.map(w =>
            new StringSelectMenuOptionBuilder()
                .setLabel(w.name)
                .setValue(w.key)
                .setDescription(w.description)
        ));

    return {
        embeds: [embed],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)]
    };
}

function build_weapon_confirm(weapon: Weapon): { embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder>[] } {
    const fields = [
        {
            name: `Defend: ${weapon.defend.map((a: Action) => a.name).join('/') || 'None'}`,
            value: weapon.defend.map((a: Action) => a.get_description()).join('\n') || '-',
            inline: true
        },
        {
            name: `Attack: ${weapon.attack.map((a: Action) => a.name).join('/') || 'None'}`,
            value: weapon.attack.map((a: Action) => a.get_description()).join('\n') || '-',
            inline: true
        },
        {
            name: `Attack Crit: ${weapon.attack_crit.map((a: Action) => a.name).join('/') || 'None'}`,
            value: weapon.attack_crit.map((a: Action) => a.get_description()).join('\n') || '-',
            inline: true
        },
        {
            name: `Special: ${weapon.special.map((a: Action) => a.name).join('/') || 'None'}`,
            value: weapon.special.map((a: Action) => a.get_description()).join('\n') || '-',
            inline: true
        }
    ];

    const embed = new EmbedBuilder()
        .setColor(0x00FFFF)
        .setTitle(`You chose ${weapon.name}!`)
        .setDescription(
            `${weapon.description}\n-------------------------------------------------------------------------------------\n` +
            `${bold('STRIKE')}: Directly does damage to target, damage is increased by BUFF and decreased by DEBUFF, BLOCK, and SHIELD\n` +
            `${bold('BLOCK')}: Reduces incoming damage from STRIKE.  Removed at end of round.\n` +
            `${bold('BUFF')}: Increases user STRIKE damage.  Lasts for specified number of ROUNDS.\n` +
            `${bold('DOT')}: Does X damage for specified number of ROUNDS.\n` +
            `${bold('DEBUFF')}: Reduces user STRIKE damage.  Lasts for specified number of ROUNDS.\n` +
            `${bold('HEAL')}: Restores health to the user.\n` +
            `${bold('REFLECT')}: If the user is targeted by STRIKE, specified damage is returned to the attacker.  Lasts for specified number of ROUNDS.\n` +
            `${bold('SHIELD')}: Reduces incoming damage from STRIKE.  Lasts for specified number of ROUNDS.`
        )
        .setFields(fields);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('CreateCharBack')
            .setLabel('Go Back')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('CreateCharConfirm')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

export default class CharacterHandler {
    pending: Map<string, { name: string; weapon_key: string }> = new Map();

    async handle_modal(interaction: ModalSubmitInteraction, repo: CharacterRepository): Promise<void> {
        const name = interaction.fields.getTextInputValue('CreateCharNameInput');
        this.pending.set(interaction.user.id, { name, weapon_key: '' });
        logger.info(`Character creation started for ${interaction.user.id}: name="${name}"`);
        await interaction.reply({
            ...build_weapon_select_components(),
            flags: MessageFlags.Ephemeral
        });
    }

    async handle_weapon_select(interaction: StringSelectMenuInteraction): Promise<void> {
        const weapon_key = interaction.values[0];
        const pending = this.pending.get(interaction.user.id);
        if (!pending) {
            await interaction.reply({ content: 'Session expired. Please run /createcharacter again.', flags: MessageFlags.Ephemeral });
            return;
        }
        pending.weapon_key = weapon_key;
        logger.info(`Weapon selected for ${interaction.user.id}: ${weapon_key}`);
        const weapon = Weapon.from_file(`./database/weapons/${weapon_key}.yaml`);
        await interaction.update(build_weapon_confirm(weapon));
    }

    async handle_confirm(interaction: ButtonInteraction, repo: CharacterRepository): Promise<void> {
        const pending = this.pending.get(interaction.user.id);
        if (!pending || !pending.weapon_key) {
            await interaction.reply({ content: 'Session expired. Please run /createcharacter again.', flags: MessageFlags.Ephemeral });
            return;
        }
        const data = await repo.create(interaction.user.id, pending.name, pending.weapon_key, undefined);
        this.pending.delete(interaction.user.id);
        logger.info(`Character created for ${interaction.user.id}: "${data.name}" with weapon "${data.weapon_key}"`);
        const weapon = Weapon.from_file(`./database/weapons/${data.weapon_key}.yaml`);
        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('Character Created!')
                    .setDescription(`**${data.name}** is ready for battle, wielding **${weapon.name}**!\n\nYour adventure begins now.`)
                    .addFields(
                        { name: 'Max HP', value: `${data.max_health}`, inline: true },
                        { name: 'Weapon', value: weapon.name, inline: true }
                    )
            ],
            components: []
        });
    }

    async handle_back(interaction: ButtonInteraction): Promise<void> {
        await interaction.update(build_weapon_select_components());
    }
}
