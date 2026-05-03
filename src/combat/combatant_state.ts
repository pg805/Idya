import logger from '../utility/logger.js';
import Action from '../weapon/action.js';
import { RollMode } from '../infrastructure/stance.js';

export interface StatusEffect {
    value: number;
    rounds: number;
}

export class CombatantState {
    name: string
    health: number
    max_health: number
    resource_name: string
    resource_max: number
    resource_current: number
    resistances: Record<string, number>
    block = 0
    dot:     StatusEffect = { value: 0, rounds: 0 }
    buff:    StatusEffect = { value: 0, rounds: 0 }
    debuff:  StatusEffect = { value: 0, rounds: 0 }
    reflect: StatusEffect = { value: 0, rounds: 0 }
    shield:  StatusEffect = { value: 0, rounds: 0 }

    constructor(
        name: string,
        health: number,
        resource_name: string,
        resource_max: number,
        resistances: Record<string, number> = {},
    ) {
        this.name = name;
        this.health = health;
        this.max_health = health;
        this.resource_name = resource_name;
        this.resource_max = resource_max;
        this.resource_current = resource_max;
        this.resistances = resistances;
    }

    // Combines type + subtype resistance scores, maps to a roll mode:
    //   score > 1.0 (weakness) → Hd4 (roll 4 dice, take highest)
    //   score < 1.0 (resist)   → Ld2 (roll 2 dice, take lowest)
    //   score = 1.0 (neutral)  → One
    get_roll_mode(action: Action): RollMode {
        let score = 1.0;
        const main = this.resistances[action.damage_type];
        if (main !== undefined) score *= main;
        const sub = this.resistances[action.damage_subtype];
        if (sub !== undefined) score *= sub;
        if (score > 1.0) return RollMode.Hd4;
        if (score < 1.0) return RollMode.Ld2;
        return RollMode.One;
    }

    apply_cost(action: Action): string {
        if (action.cost === 0) return '';
        const before = this.resource_current;
        this.resource_current = Math.max(0, Math.min(this.resource_max, this.resource_current - action.cost));
        return `  [${this.resource_name}: ${before} → ${this.resource_current}]`;
    }

    private tick_effect(effect: StatusEffect, label: string): string {
        if (effect.rounds <= 0) return '';
        effect.rounds -= 1;
        if (effect.rounds === 0) effect.value = 0;
        logger.info(`${label} rounds for ${this.name}: ${effect.rounds}`);
        return `\n${this.name} has ${effect.rounds} round(s) left on their ${label}.`;
    }

    end_round(): string {
        let action_string = '';
        this.block = 0;

        if (this.dot.rounds > 0) {
            const hp_before = this.health;
            this.health = Math.max(this.health - this.dot.value, 0);
            this.dot.rounds -= 1;
            action_string += `\n${this.name} takes ${this.dot.value} DOT damage (${this.dot.rounds} round(s) remaining)  |  HP: ${hp_before} → ${this.health}`;
            logger.info(`End of Turn DOT on ${this.name}\nDamage: ${this.dot.value}\nRounds Left: ${this.dot.rounds}\nHealth: ${this.health}`);
            if (this.dot.rounds === 0) this.dot.value = 0;
        }

        action_string += this.tick_effect(this.buff,    'buff');
        action_string += this.tick_effect(this.debuff,  'debuff');
        action_string += this.tick_effect(this.reflect, 'reflect');
        action_string += this.tick_effect(this.shield,  'shield');

        return action_string;
    }
}
