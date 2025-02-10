import * as readline from 'readline';

class Result_Field {
    length: number
    field: Array<number>

    constructor(field: Array<number>) {
        this.field = field
        this.length = field.length
    }

    get_result() {
        return this.field[Math.floor(Math.random() * this.length)];
    }
}

class Pattern {
    length: number
    field: Array<number>

    constructor(field: Array<number>) {
        this.field = field
        this.length = field.length
    }
}

class Non_Player_Character {
    name: string
    health: number
    defend: number
    attack: Result_Field
    special: Result_Field
    pattern: Pattern

    constructor(name: string, health: number, pattern: Pattern, defend: number, attack: Result_Field, special: Result_Field) {
        this.name = name
        this.health = health
        this.defend = defend
        this.attack = attack
        this.special = special
        this.pattern = pattern
    }
}

class Player_Character {
    name: string
    health: number
    defend: number
    attack: Result_Field
    special: Result_Field

    constructor(name: string, health: number, defend: number, attack: Result_Field, special: Result_Field) {
        this.name = name
        this.health = health
        this.defend = defend
        this.attack = attack
        this.special = special
    }
}

class Battle {
    player_character: Player_Character
    non_player_character: Non_Player_Character
    pc_health: number;
    npc_health: number;
    npc_index: number = 0;
    current_round: number = 1;
    complete:boolean = false;
    winner: string = '';

    constructor(player_character: Player_Character, non_player_character: Non_Player_Character) {
        this.player_character = player_character
        this.non_player_character = non_player_character
        this.pc_health = player_character.health
        this.npc_health = non_player_character.health
    }

    check_winners() {
        // Specify Tie
        if(this.pc_health == 0 && this.npc_health == 0) {
            return this.non_player_character.name
        }

        // NPC Win
        if(this.pc_health == 0) {
            return this.non_player_character.name
        }

        // PC Win
        if(this.npc_health == 0) {
            return this.player_character.name
        }

        return ""
    }

    resolve_round(player_action: number) {
        const npc_action: number = this.non_player_character.pattern.field[this.npc_index]
        console.log(
`***************************
Resolving Turn
Current Round: ${this.current_round}
Player Health: ${this.pc_health}
Non Player Health: ${this.npc_health}
Player Action: ${player_action}
Non Player Character Action: ${npc_action}
`
        )

        // Player Attack
        if(player_action == 2) {
            const player_roll = this.player_character.attack.get_result()

            let damage = 0
            if(npc_action == 1) {
                damage = Math.max(player_roll - this.non_player_character.defend, 0)
            } else {
                damage = player_roll
            }

            this.npc_health = Math.max(this.npc_health - damage, 0)

            console.log(
`
Resolving Player Attack
Player Roll: ${player_roll}
Damage: ${damage}
Updated Health: ${this.npc_health}
`
            )
        }

        // Non Player Attack
        if(npc_action == 2) {
            const non_player_roll = this.non_player_character.attack.get_result()

            let damage = 0
            if(player_action == 1) {
                damage = Math.max(non_player_roll - this.non_player_character.defend, 0)
            } else {
                damage = non_player_roll
            }

            this.pc_health = Math.max(this.pc_health - damage, 0)

            console.log(
`
Resolving Non Player Attack
Non Player Roll: ${non_player_roll}
Damage: ${damage}
Updated Health: ${this.pc_health}
`
            )
        }

        // Check For Winners
        this.winner = this.check_winners()
        if(this.winner) {
            return this.winner
        }

        // Player Special
        if(player_action == 3) {
            const player_roll = this.player_character.special.get_result()

            // TODO: Special Defense
            const damage = player_roll

            this.npc_health = Math.max(this.npc_health - damage, 0)

            console.log(
`
Resolving Player Special
Player Roll: ${player_roll}
Damage: ${damage}
Updated Health: ${this.npc_health}
`
            )
        }

        // Non Player Special
        if(npc_action == 3) {
            const non_player_roll = this.non_player_character.special.get_result()

            // TODO: Special Defense
            const damage = non_player_roll

            this.pc_health = Math.max(this.pc_health - damage, 0)

            console.log(
`
Resolving Non Player Special
Non Player Roll: ${non_player_roll}
Damage: ${damage}
Updated Health: ${this.pc_health}
`
            )
        }

        // Check For Winners
        this.winner = this.check_winners()

        // Round End Updating
        this.current_round += 1
        this.npc_index = (this.npc_index + 1) % this.non_player_character.pattern.length

        return this.winner
    }
}

/* Human Actions */
const human_defend: number = 7
const human_attack: Result_Field = new Result_Field([0, 3, 4, 5, 5, 5, 6, 8, 10])
const human_special: Result_Field = new Result_Field([5, 10, 10, 20])

/* Rat Actions */
const rat_defend: number = 5
const rat_attack: Result_Field = new Result_Field([0, 3, 5, 5, 7, 10])
const rat_special: Result_Field = new Result_Field([3, 9, 15, 15])

/* Characters */
const human: Player_Character = new Player_Character(
    'Human',
    100,
    human_defend,
    human_attack,
    human_special
)

const rat_pattern: Pattern = new Pattern([1, 2, 3])
const rat: Non_Player_Character = new Non_Player_Character(
    'Rat',
    100,
    rat_pattern,
    rat_defend,
    rat_attack,
    rat_special
)

const test_battle: Battle = new Battle(
    human,
    rat
)

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

while(!test_battle.winner){
    await new Promise((resolve, reject) => rl.question('Player Action? [Defend=1, Attack=2, Special=3] > ', (answer: string) => {
        let winner = ''
        switch(answer.toLowerCase()) {
            case '1':
            case 'defend':
                console.log('Player Defending')
                winner = test_battle.resolve_round(1)
                break;
            case '2':
            case 'attack':
                console.log('Player Attacking')
                winner = test_battle.resolve_round(2)
                break;
            case '3':
            case 'special':
                console.log('Player Specialing')
                winner = test_battle.resolve_round(3)
                break;
            default:
                console.log('Please input 1, 2, or 3')
        }
        if(winner) {
            rl.close()
        }
        resolve(true)
    }))
}

console.log(`
******************************
Winner: ${test_battle.winner}!
`)