import logger from "../util/logger";
import { check_crit } from "./action";
import Battle_Player from "./battle_player";
import { STATE, EFFECT } from './constant';

class Target_Data {
    target: Battle_Player;
    amount: number;
    type: string;
    crit: boolean;

    constructor(target: Battle_Player, amount: number, type: string, crit: boolean) {
        this.target = target;
        this.amount = amount;
        this.type = type;
        this.crit = crit;
    }

    to_string() {

        let attack_type: string = '';
        let resource: string = '';

        switch(this.type) {
            case EFFECT.HEAL:
                attack_type = 'heals';
                resource = 'health';
                break;
            case EFFECT.DAMAGE:
                attack_type = 'damages';
                resource = 'health';
                break;
            default:
                logger.warn(`Unknown Target Data type: ${this.type}`);
                resource = 'potatoes';
                attack_type = 'fries';
        }

        return `${this.crit ? 'critically ':''}${attack_type} ${this.target.name} for ${this.amount} ${resource}`
    }
}

class Action_Data {
    executor: Battle_Player;
    targets: Array<Target_Data>;

    constructor(executor: Battle_Player) {
        logger.debug(`Creating Action for ${executor.name}`);
        this.executor = executor;
        this.targets = [];
    }

    add_target(player: Battle_Player, amount: number, type: string, crit: boolean) {
        logger.debug(`Adding Target to ${this.executor.name}'s action in action:\nTarget: ${player.name}\nAmount: ${amount}\nType:${type}`);
        this.targets.push(new Target_Data(player, amount, type, crit));
    }

    to_string() {
        return `\n${this.executor.name} ${this.targets.flatMap((target: Target_Data) => target.to_string()).join(`\nand `)}.`;
    }
}

// say who killed them an how???
class Death_Data {
    dead_people: Array<Battle_Player>;

    constructor() {
        this.dead_people = [];
    }

    death(player: Battle_Player) {
        this.dead_people.push(player);
    }

    death_check() {
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
        return !!this.winners.length;
    }

    set_winners(winners: Array<Battle_Player>) {
        this.winners = winners;
    }

    // propper grammar
    to_string() {
        return `Congratulations ${this.winners.flatMap((player: Battle_Player) => player.name).join(', ')}! You won the battle!`
    }
}

export default class Battle_Data {
    action_log: Array<Action_Data>;
    death_log: Death_Data;
    win_log: Win_Data;
    turn_count: number;

    constructor(turn_count: number) {
        this.action_log = [];
        this.death_log = new Death_Data;
        this.win_log = new Win_Data;
        this.turn_count = turn_count;
    }

    add_action(player: Battle_Player) {
        logger.debug(`Adding Action Data for ${player.name}`);
        this.action_log.push(new Action_Data(player));
    }

    add_target(executor: Battle_Player, target: Battle_Player, amount: number, type: string, crit: boolean) {
        logger.debug(`Adding Target to ${executor.name}'s action data:\nName: ${target.name}\nAmount: ${amount}\nType: ${type}`);
        const target_action = this.action_log.find((action: Action_Data) => action.executor == executor);
        logger.debug(`Found action for this target: ${!!target_action}`);
        if(target_action) {
            target_action.add_target(target, amount, type, crit)
        }
    }

    add_death(dead_player: Battle_Player) {
        logger.debug(`Adding Death: ${dead_player.name}`);
        this.death_log.death(dead_player);
    }

    death_check() {
        logger.debug(`Checking Death: ${this.death_log.death_check()}`);
        return this.death_log.death_check();
    }

    
    set_winners(winners: Array<Battle_Player>) {
        logger.debug(`Setting winners: ${winners.flatMap(p => p.name).join(', ')}`);
        this.win_log.set_winners(winners);
    }

    win_check() {
        logger.debug(`Checking Win: ${this.win_log.check()}`);
        return this.win_log.check()
    }
    
    to_string() {
        let return_string: string = '===========================================\n';

        return_string += `**Round Count**: ${this.turn_count}`;

        return_string += '\n===========================================';

        this.action_log.forEach((action: Action_Data) =>{
            return_string += action.to_string();
        });

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