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
// Apply an action's resource cost (side effect) and return it as a bare
// resolution string — "−1 Flow" / "+6 Solitude" / "" (no indent, no brackets).
// The caller pushes it into the resolution stack BEFORE the Total line.
function costStr(s: CombatantState, a: Action): string {
    const r = s.apply_cost(a);   // "  [−1 Flow]" / "  [+6 Solitude]" / ""
    return r ? r.replace(/^\s*\[/, '').replace(/\]$/, '') : '';
}

// Flavor leads the block (prose above the action), then the header, then the
// indented resolution lines. The flavor line is prefixed with U+200B so the
// client classifies it as flavor even when the prose itself contains " — "
// (many flavor strings do) — the marker is stripped before display.
export const FLAVOR_MARK = String.fromCharCode(0x200B);   // zero-width space — flavor classifier, stripped on render
function block(header: string, lines: string[], flavor: string): string {
    const body = lines.length ? `\n${lines.join('\n')}` : '';
    return `\n${FLAVOR_MARK}${flavor}\n${header}${body}`;
}

// The roll, as resolution lines. A multi-die mode (weakness/resist) gets a
// mode-header line, then the FULL field once PER die with that die's face bolded
// (two dice on the same face still show as two lines). 1d → just the field line.
function rollLines(field: number[], indices: number[], mode: RollMode): string[] {
    const out: string[] = [];
    if (mode === RollMode.Ld2)        out.push('    Resist (take lowest)');
    else if (mode !== RollMode.One)   out.push('    Weakness (take highest)');
    for (const idx of indices) {
        out.push(`    [${field.map((v, i) => i === idx ? `**${v}**` : `${v}`).join(', ')}]`);
    }
    return out;
}

// A strike's roll breakdown as resolve lines (mode + per-die fields + modifier
// lines) plus the dealt damage; applies the damage to the target's HP. The cost
// and the Total line are left to the caller, so an AOE can pay its cost once and
// print a Total per victim. Shared by the single-target Strike branch and the
// AOE resolver.
export function strikeBreakdown(attacker: CombatantState, target: CombatantState, action: Strike): { damage: number; lines: string[] } {
    const roll_mode = target.get_roll_mode(action);
    const { result: damage_roll, indices } = action.field.roll_detail(roll_mode);
    const damage = Math.max(damage_roll - target.block - target.shield.value + attacker.buff.value + attacker.tileBuff - attacker.debuff.value, 0);
    const hp_before = target.health;
    target.health = Math.max(target.health - damage, 0);
    target.damage_taken += hp_before - target.health;
    const lines = rollLines(action.field.field, indices, roll_mode);
    if (target.block)          lines.push(`    − block ${target.block}`);
    if (target.shield.value)   lines.push(`    − shield ${target.shield.value}`);
    if (attacker.tileBuff)     lines.push(`    + tile ${attacker.tileBuff}`);
    if (attacker.buff.value)   lines.push(`    + buff ${attacker.buff.value}`);
    if (attacker.debuff.value) lines.push(`    − debuff ${attacker.debuff.value}`);
    return { damage, lines };
}

// Resolution lines for the structured log. Standard shape:
//   <actor> — <action>[ → <target>][: effect]     ← action level (header)
//       roll / modifier / total / cost lines        ← 4-space indent (resolution)
//   flavor prose                                    ← action level (no indent)
function apply_self_actions(actor: CombatantState, actions: Action[]): string {
    let action_string = '';

    for (const action of actions) {
        if (action.type === ActionType.Block) {
            // Block is ADDITIVE within a turn — a second guard this round (e.g. a
            // defend-crit riposte) stacks on top rather than overwriting it.
            const added = (action as Block).value;
            actor.block += added;
            const cost = costStr(actor, action);   // "+7 Flow" (regain) / "−1 Flow" / ""
            // value>0: "Block N" on the action line + a "block N" resolve line.
            // value==0 (pure restore, e.g. Wellspring): BLANK action line — its only
            // effect is the regain, which shows in resolve as "+N <resource>".
            const effect = added > 0 ? `: Block ${added}` : '';
            const lines: string[] = [];
            if (added > 0) lines.push(`    block ${added}`);
            if (cost) lines.push(`    ${cost}`);
            action_string += block(`<User> — ${action.name}${effect}`, lines, action.action_string);
            logger.info(`Resolving ${actor.name} Block: ${action.name}\nValue: ${added}  Total: ${actor.block}`);
        }

        if (action.type === ActionType.Reflect) {
            actor.reflect.value  = (action as Reflect).value;
            actor.reflect.rounds = (action as Reflect).rounds;
            const cost = costStr(actor, action);
            const lines = [`    reflect ${actor.reflect.value} · ${actor.reflect.rounds} turns`];
            if (cost) lines.push(`    ${cost}`);
            action_string += block(`<User> — ${action.name}: Reflect ${actor.reflect.value} · ${actor.reflect.rounds} turns`, lines, action.action_string);
            logger.info(`Resolving ${actor.name} Reflect: ${action.name}\nValue: ${actor.reflect.value}  Rounds: ${actor.reflect.rounds}`);
        }

        if (action.type === ActionType.Shield) {
            actor.shield.value  = (action as Shield).value;
            actor.shield.rounds = (action as Shield).rounds;
            const cost = costStr(actor, action);
            const lines = [`    shield ${actor.shield.value} · ${actor.shield.rounds} turns`];
            if (cost) lines.push(`    ${cost}`);
            action_string += block(`<User> — ${action.name}: Shield ${actor.shield.value} · ${actor.shield.rounds} turns`, lines, action.action_string);
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

    for (const action of actions) {
        if (action.type === ActionType.Strike) {
            reflect = true;
            const { damage, lines } = strikeBreakdown(attacker, target, action as Strike);
            const cost = costStr(attacker, action);
            if (cost) lines.push(`    ${cost}`);
            lines.push(`    Total ${damage}`);
            // Damage on the action line (the glance value — resolve is hidden by
            // default); the full roll math + Total stay in the resolve stack.
            target_string += block(`<User> — ${action.name}${arrow}: ${damage}`, lines, action.action_string);
            logger.info(`Resolving Strike on ${target.name}: ${action.name}  Damage: ${damage}  HP: ${target.health}`);
        }

        if (action.type === ActionType.DamageOverTime) {
            const roll_mode = target.get_roll_mode(action);
            const { result: damage, indices } = (action as Damage_Over_Time).field.roll_detail(roll_mode);
            const rounds = (action as Damage_Over_Time).rounds;
            target.dot.value  = damage;
            target.dot.rounds = rounds;
            const lines = rollLines((action as Damage_Over_Time).field.field, indices, roll_mode);
            const cost = costStr(attacker, action);
            if (cost) lines.push(`    ${cost}`);
            lines.push(`    Total ${damage} per turn · ${rounds} turns`);
            target_string += block(`<User> — ${action.name}${arrow}: ${damage} per turn · ${rounds} turns`, lines, action.action_string);
            logger.info(`Resolving DOT on ${target.name}: ${action.name}  Damage: ${damage} (${roll_mode})  Rounds: ${rounds}`);
        }

        if (action.type === ActionType.Debuff) {
            target.debuff.value  = (action as Debuff).value;
            target.debuff.rounds = (action as Debuff).rounds;
            target.buff.value  = 0;
            target.buff.rounds = 0;
            const cost = costStr(attacker, action);
            const lines = [`    debuff ${target.debuff.value} · ${target.debuff.rounds} turns`];
            if (cost) lines.push(`    ${cost}`);
            target_string += block(`<User> — ${action.name}${arrow}: Debuff ${target.debuff.value} · ${target.debuff.rounds} turns`, lines, action.action_string);
            logger.info(`Resolving Debuff on ${target.name}: ${action.name}\nValue: ${target.debuff.value}  Rounds: ${target.debuff.rounds}`);
        }

        if (action.type === ActionType.MoveDebuff) {
            target.moveDebuff.value  = (action as MoveDebuff).value;
            target.moveDebuff.rounds = (action as MoveDebuff).rounds;
            const cost = costStr(attacker, action);
            const lines = [`    slow ${target.moveDebuff.value} · ${target.moveDebuff.rounds} turns`];
            if (cost) lines.push(`    ${cost}`);
            target_string += block(`<User> — ${action.name}${arrow}: Slow ${target.moveDebuff.value} · ${target.moveDebuff.rounds} turns`, lines, action.action_string);
            logger.info(`Resolving Move Debuff on ${target.name}: ${action.name}\nCap: ${target.moveDebuff.value}  Rounds: ${target.moveDebuff.rounds}`);
        }

        if (action.type === ActionType.Buff) {
            target.buff.value  = (action as Buff).value;
            target.buff.rounds = (action as Buff).rounds;
            target.debuff.value  = 0;
            target.debuff.rounds = 0;
            const cost = costStr(attacker, action);
            const lines = [`    buff ${target.buff.value} · ${target.buff.rounds} turns`];
            if (cost) lines.push(`    ${cost}`);
            target_string += block(`<User> — ${action.name}${arrow}: Buff ${target.buff.value} · ${target.buff.rounds} turns`, lines, action.action_string);
            logger.info(`Resolving ${attacker.name} Buff on ${target.name}: ${action.name}\nValue: ${target.buff.value}  Rounds: ${target.buff.rounds}`);
        }

        if (action.type === ActionType.Heal) {
            const heal = (action as Heal).value;
            const hp_before = target.health;
            target.health = Math.min(target.health + heal, target.max_health);
            const actualHeal = target.health - hp_before;
            const cost = costStr(attacker, action);
            const lines = [`    heal ${actualHeal}`];
            if (cost) lines.push(`    ${cost}`);
            target_string += block(`<User> — ${action.name}${arrow}: Heal ${actualHeal}`, lines, action.action_string);
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
    // Flavor is a number-free description now. Defensively strip the common
    // "<Damage>"-clause shapes left in older YAML so no raw token leaks, then
    // tidy any double spaces / orphaned punctuation.
    return `${self_str}${target_string}${reflect_str}`
        .replace(/,? (dealing|for|striking for|bursting for|take|taking) <Damage>[^.\n]*?(?=[.,]|$)/gi, '')
        .replace(/<Damage>[^.,\n]*/g, '')
        .replace(/ {2,}/g, ' ')
        .replace(/ +([.,])/g, '$1')
        .replace(/<User>/g, actor.name)
        .replace(/<Target>/g, target.name);
}
