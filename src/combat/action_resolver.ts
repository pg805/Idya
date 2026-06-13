import logger from '../utility/logger.js';
import Action, { ActionType } from '../weapon/action.js';
import Strike from '../weapon/action/strike.js';
import Damage_Over_Time from '../weapon/action/damage_over_time.js';
import Debuff from '../weapon/action/debuff.js';
import Block from '../weapon/action/block.js';
import Buff from '../weapon/action/buff.js';
import Heal from '../weapon/action/heal.js';
import Shield from '../weapon/action/shield.js';
import Reflect from '../weapon/action/reflect.js';
import MoveDebuff from '../weapon/action/move_debuff.js';
import { RollMode } from '../infrastructure/roll_mode.js';
import { CombatantState } from './combatant_state.js';

// Each action produces:
//   - one MAIN line in the format `<User>[…] — <Name>: <result> [±cost]`
//     (the source of truth players read to track what happened)
//   - one FLAVOR line indented underneath (toggleable on the client)
//   - optional MECHANICS detail for strikes / DOTs (also toggleable, deeper)
//
// Self-targeted actions (block, reflect, shield, self-heal/buff) omit the
// `→ <Target>` segment since the actor is targeting themselves. Hostile
// actions always include the arrow + target.
// Apply an action's resource cost (side effect) and return it as an indented
// resolution line — "\n    −1 Flow" (or "\n    +6 Solitude" for a regain), or ''.
function costLine(s: CombatantState, a: Action): string {
    const r = s.apply_cost(a);   // "  [−1 Flow]" / "  [+6 Solitude]" / ""
    return r ? `\n    ${r.replace(/^\s*\[/, '').replace(/\]$/, '')}` : '';
}

// Resolution lines for the structured log. Standard shape:
//   <actor> — <action>[ → <target>][: effect]     ← action level (header)
//       roll / modifier / total / cost lines        ← 4-space indent (resolution)
//   flavor prose                                    ← action level (no indent)
function apply_self_actions(actor: CombatantState, actions: Action[]): string {
    let action_string = '';

    for (const action of actions) {
        if (action.type === ActionType.Block) {
            actor.block = (action as Block).value;
            // A value-0 Block is a pure restore — the cost line shows the regain.
            const effect = actor.block > 0 ? `: blocks ${actor.block}` : '';
            const flavor = action.action_string.replace('<Damage>', `${actor.block}`);
            action_string += `\n<User> — ${action.name}${effect}${costLine(actor, action)}\n${flavor}`;
            logger.info(`Resolving ${actor.name} Block: ${action.name}\nValue: ${actor.block}`);
        }

        if (action.type === ActionType.Reflect) {
            actor.reflect.value  = (action as Reflect).value;
            actor.reflect.rounds = (action as Reflect).rounds;
            action_string += `\n<User> — ${action.name}: reflect ${actor.reflect.value} · ${actor.reflect.rounds} turns${costLine(actor, action)}\n${action.action_string}`;
            logger.info(`Resolving ${actor.name} Reflect: ${action.name}\nValue: ${actor.reflect.value}  Rounds: ${actor.reflect.rounds}`);
        }

        if (action.type === ActionType.Shield) {
            actor.shield.value  = (action as Shield).value;
            actor.shield.rounds = (action as Shield).rounds;
            action_string += `\n<User> — ${action.name}: shields ${actor.shield.value} · ${actor.shield.rounds} turns${costLine(actor, action)}\n${action.action_string}`;
            logger.info(`Resolving ${actor.name} Shield: ${action.name}\nValue: ${actor.shield.value}  Rounds: ${actor.shield.rounds}`);
        }
    }

    return action_string;
}

function apply_hostile_actions(
    target: CombatantState,
    attacker: CombatantState,
    actions: Action[],
): { target_string: string; reflect: boolean } {
    let target_string = '';
    let reflect = false;

    // Hostile actions show "→ <Target>"; a self-target heal/buff (attacker ===
    // target, routed here by resolve_action) collapses the arrow.
    const arrow = attacker.name === target.name ? '' : ' → <Target>';
    // Each die is an independent roll of the FULL field, so a multi-die mode shows
    // the field once PER die with that die's face bolded (two dice that land on the
    // same face still show as two lines). 1d → one line.
    const rollLine = (field: number[], indices: number[], mode: RollMode): string => {
        const tag = mode === RollMode.One ? ''
            : mode === RollMode.Ld2 ? '  resist (lowest)' : '  weakness (highest)';
        return indices.map((idx, n) => {
            const faces = field.map((v, i) => i === idx ? `**${v}**` : `${v}`).join(', ');
            return n === 0 ? `    rolls [${faces}]${tag}` : `    [${faces}]`;
        }).join('\n');
    };

    for (const action of actions) {
        if (action.type === ActionType.Strike) {
            reflect = true;
            const roll_mode = target.get_roll_mode(action);
            const { result: damage_roll, indices } = (action as Strike).field.roll_detail(roll_mode);
            const damage = Math.max(damage_roll - target.block - target.shield.value + attacker.buff.value + attacker.tileBuff - attacker.debuff.value, 0);
            const hp_before = target.health;
            target.health = Math.max(target.health - damage, 0);
            target.damage_taken += hp_before - target.health;

            const lines = [rollLine((action as Strike).field.field, indices, roll_mode)];
            if (target.block)          lines.push(`    − block ${target.block}`);
            if (target.shield.value)   lines.push(`    − shield ${target.shield.value}`);
            if (attacker.tileBuff)     lines.push(`    + tile ${attacker.tileBuff}`);
            if (attacker.buff.value)   lines.push(`    + buff ${attacker.buff.value}`);
            if (attacker.debuff.value) lines.push(`    − debuff ${attacker.debuff.value}`);
            lines.push(`    Total ${damage}`);
            const flavor = action.action_string.replace('<Damage>', `${damage}`);
            target_string += `\n<User> — ${action.name}${arrow}\n${lines.join('\n')}${costLine(attacker, action)}\n${flavor}`;
            logger.info(`Resolving Strike on ${target.name}: ${action.name}  Roll: ${damage_roll} (${roll_mode})  Damage: ${damage}  HP: ${target.health}`);
        }

        if (action.type === ActionType.DamageOverTime) {
            const roll_mode = target.get_roll_mode(action);
            const { result: damage, indices } = (action as Damage_Over_Time).field.roll_detail(roll_mode);
            const rounds = (action as Damage_Over_Time).rounds;
            target.dot.value  = damage;
            target.dot.rounds = rounds;
            const lines = [
                rollLine((action as Damage_Over_Time).field.field, indices, roll_mode),
                `    ${damage} per turn · ${rounds} turns`,
            ];
            const flavor = action.action_string.replace('<Damage>', `${damage}`);
            target_string += `\n<User> — ${action.name}${arrow}\n${lines.join('\n')}${costLine(attacker, action)}\n${flavor}`;
            logger.info(`Resolving DOT on ${target.name}: ${action.name}  Damage: ${damage} (${roll_mode})  Rounds: ${rounds}`);
        }

        if (action.type === ActionType.Debuff) {
            target.debuff.value  = (action as Debuff).value;
            target.debuff.rounds = (action as Debuff).rounds;
            target.buff.value  = 0;
            target.buff.rounds = 0;
            target_string += `\n<User> — ${action.name}${arrow}: −${target.debuff.value} atk · ${target.debuff.rounds} turns${costLine(attacker, action)}\n${action.action_string}`;
            logger.info(`Resolving Debuff on ${target.name}: ${action.name}\nValue: ${target.debuff.value}  Rounds: ${target.debuff.rounds}`);
        }

        if (action.type === ActionType.MoveDebuff) {
            target.moveDebuff.value  = (action as MoveDebuff).value;
            target.moveDebuff.rounds = (action as MoveDebuff).rounds;
            target_string += `\n<User> — ${action.name}${arrow}: slow ${target.moveDebuff.value} · ${target.moveDebuff.rounds} turns${costLine(attacker, action)}\n${action.action_string}`;
            logger.info(`Resolving Move Debuff on ${target.name}: ${action.name}\nCap: ${target.moveDebuff.value}  Rounds: ${target.moveDebuff.rounds}`);
        }

        if (action.type === ActionType.Buff) {
            target.buff.value  = (action as Buff).value;
            target.buff.rounds = (action as Buff).rounds;
            target.debuff.value  = 0;
            target.debuff.rounds = 0;
            target_string += `\n<User> — ${action.name}${arrow}: +${target.buff.value} atk · ${target.buff.rounds} turns${costLine(attacker, action)}\n${action.action_string}`;
            logger.info(`Resolving ${attacker.name} Buff on ${target.name}: ${action.name}\nValue: ${target.buff.value}  Rounds: ${target.buff.rounds}`);
        }

        if (action.type === ActionType.Heal) {
            const heal = (action as Heal).value;
            const hp_before = target.health;
            target.health = Math.min(target.health + heal, target.max_health);
            const actualHeal = target.health - hp_before;
            target_string += `\n<User> — ${action.name}${arrow}: +${actualHeal} HP${costLine(attacker, action)}\n${action.action_string}`;
            logger.info(`Resolving ${attacker.name} Heal on ${target.name}: ${action.name}\nValue: ${heal}  HP: ${hp_before} → ${target.health}`);
        }
    }

    return { target_string, reflect };
}

function apply_reflect(actor: CombatantState, damage: number): string {
    if (damage <= 0) return '';
    const hp_before = actor.health;
    actor.health = Math.max(actor.health - damage, 0);
    actor.damage_taken += hp_before - actor.health;
    return `\n    ↺ ${damage} reflected to <User>`;
}

export function resolve_action(actor: CombatantState, target: CombatantState, actions: Action[]): string {
    const self_str = apply_self_actions(actor, actions);
    const { target_string, reflect } = apply_hostile_actions(target, actor, actions);
    const reflect_str = reflect ? apply_reflect(actor, target.reflect.value) : '';
    return `${self_str}${target_string}${reflect_str}`
        .replace(/<User>/g, actor.name)
        .replace(/<Target>/g, target.name);
}
