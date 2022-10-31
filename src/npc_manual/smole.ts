import Action from "../types/action";
import NonPlayerCharacter from "../types/character/nonPlayerCharacter";
import Item from "../types/item";

const smole = new NonPlayerCharacter();

/* Set Pattern */
smole.pattern.sequence = [1, 2]
smole.pattern.deviationPercent = 10

/* 
Item - claw
    Action - Scratch 
    Action - Poison
*/
const claw = new Item()
claw.name = 'claw'
claw.hp = 100

const scratch = new Action()
scratch.name = 'scratch'
scratch.actionType.setAttack()
scratch.effect.effectType.setDamage()
scratch.effect.baseValue = 10
scratch.effect.randomValue = 10

claw.actions.push(scratch)

const poison = new Action()
poison.name = 'poison'
poison.actionType.setSpecial()
poison.effect.effectType.setDamage()
poison.effect.baseValue = 0
poison.effect.randomValue = 40

claw.actions.push(poison)

smole.activeItems.push(claw)

smole.setTotalHealth()

export default smole