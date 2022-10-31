import logger from "../util/logger";
import { check_crit } from "./action";
import Battle_Player, { Battle_Status } from "./battle_player";
import { STATE, EFFECT } from './constant';

class Effect_Data {
    target: Battle_Player;
    intensity: number;
    name: string;
    type: string;

    constructor(target: Battle_Player, intensity: number, name: string, type: string) {
        this.target = target;
        this.intensity = intensity;
        this.name = name;
        this.type = type;
    }

    to_string() {
        return `\n${this.name} affects ${this.target.name} for ${this.intensity} health`
    }
}

class Target_Data {
    target: Battle_Player;
    amount: number;
    type: string;
    crit: boolean;
    string: string;

    constructor(target: Battle_Player, amount: number, type: string, crit: boolean, string: string) {
        this.target = target;
        this.amount = amount;
        this.type = type;
        this.crit = crit;
        this.string = string;
    }

    to_string() {
        return this.string;
    }
}

class Action_Data {
    executor: Battle_Player;
    targets: Array<Target_Data>;

    constructor(executor: Battle_Player) {
        logger.debug(`Action Data - Creating Action for ${executor.name}`);
        this.executor = executor;
        this.targets = [];
    }

    add_target(player: Battle_Player, amount: number, type: string, crit: boolean, string: string) {
        logger.debug(`Action Data - Adding Target to ${this.executor.name}'s action in action:\nTarget: ${player.name}\nAmount: ${amount}\nType:${type}`);
        this.targets.push(new Target_Data(player, amount, type, crit, string));
    }

    to_string() {
        return `\n${this.targets.flatMap((target: Target_Data) => target.to_string()).join(`\nand `)}`;
    }
}

// say who killed them an how???
class Death_Data {
    dead_people: Array<Battle_Player>;

    constructor() {
        this.dead_people = [];
    }

    death(player: Battle_Player) {
        logger.debug(`Death Data - Adding ${player.name} to death array`);
        this.dead_people.push(player);
    }

    death_check() {
        logger.debug(`Death Data - Checking Death Array`)
        return !!this.dead_people.length;
    }

    to_string() {
        return this.dead_people.flatMap((player: Battle_Player) => `${player.name} has died!`).join('\n');
    }
}

// class Passive_Data {

// }

// say who is still alive and who isn't??
class Win_Data {
    winners: Array<Battle_Player>;

    constructor() {
        this.winners = [];
    }

    check() {
        logger.debug(`Winners - Checking Winners`)
        return !!this.winners.length;
    }

    set_winners(winners: Array<Battle_Player>) {
        logger.debug(`Winners - Setting Winners ${winners.flatMap(p => p.name).join(', ')}`)
        this.winners = winners;
    }

    // propper grammar
    to_string() {
        return `Congratulations ${this.winners.flatMap((player: Battle_Player) => player.name).join(', ')}! You won the battle!`
    }
}

export default class Battle_Data {
    action_log: Array<Action_Data>;
    effect_log: Array<Effect_Data>
    death_log: Death_Data;
    win_log: Win_Data;
    turn_count: number;

    constructor(turn_count: number) {
        this.action_log = [];
        this.effect_log = [];
        this.death_log = new Death_Data;
        this.win_log = new Win_Data;
        this.turn_count = turn_count;
    }

    add_action(player: Battle_Player) {
        logger.debug(`Battle Data - Adding Action Data for ${player.name}`);
        this.action_log.push(new Action_Data(player));
    }

    add_target(executor: Battle_Player, target: Battle_Player, amount: number, type: string, crit: boolean, string: string) {
        logger.debug(`Battle Data - Adding Target to ${executor.name}'s action data:\nName: ${target.name}\nAmount: ${amount}\nType: ${type}`);
        const target_action = this.action_log.find((action: Action_Data) => action.executor == executor);
        logger.debug(`Battle Data - Found action for this target: ${!!target_action}`);
        if(target_action) {
            target_action.add_target(target, amount, type, crit, string)
        }
    }

    add_effect(target: Battle_Player, status: Battle_Status) {
        logger.debug(`Battle Data - Adding Effect Status for ${target.name}\nStatus: ${status.status.name}\nIntensity: ${status.intensity}`);
        this.effect_log.push(new Effect_Data(target, status.intensity, status.status.name, status.status.type))
    }

    add_death(dead_player: Battle_Player) {
        logger.debug(`Battle Data - Adding Death: ${dead_player.name}`);
        this.death_log.death(dead_player);
    }

    death_check() {
        logger.debug(`Battle Data - Checking Death: ${this.death_log.death_check()}`);
        return this.death_log.death_check();
    }

    
    set_winners(winners: Array<Battle_Player>) {
        logger.debug(`Battle Data - Setting winners: ${winners.flatMap(p => p.name).join(', ')}`);
        this.win_log.set_winners(winners);
    }

    win_check() {
        logger.debug(`Battle Data - Checking Win: ${this.win_log.check()}`);
        return this.win_log.check()
    }
    
    to_string() {
        let return_string: string = '===========================================\n';

        return_string += `**Round Count**: ${this.turn_count}`;

        return_string += '\n===========================================';

        return_string += `\n**Action Log**`

        this.action_log.forEach((action: Action_Data) =>{
            return_string += action.to_string();
        });

        return_string += '\n===========================================';
        return_string += `\n**End of Turn Effect Log**`

        this.effect_log.forEach((effect_data: Effect_Data) =>
            return_string += effect_data.to_string()
        ); 

        return_string += '\n===========================================';
        
        if(this.death_check()) {
            return_string += '\n';
            
            return_string += this.death_log.to_string();
            
            return_string += '\n===========================================';
        }
        
        if(this.win_check()) {
            return_string += '\n'
            
            return_string += this.win_log.to_string();

            return_string += '\n===========================================';
        }
        
        return return_string;
    }
}