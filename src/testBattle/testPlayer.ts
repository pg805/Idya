import Action from "../types/action";
import PlayerCharacter from "../types/character/playerCharacter";
import Item from "../types/item";

const player = new PlayerCharacter()

/* 
Item - shield
    Action - block
*/
const shield = new Item()
shield.name = 'shield'
shield.hp = 50

const block = new Action()
block.name = 'scratch'
block.actionType.setDefend()
block.effect.effectType.setBlock()
block.effect.baseValue = 20
block.effect.randomValue = 10

shield.actions.push(block)
/* 
Item - sword
    Action - block
*/
const sword = new Item()
sword.name = 'sword'
sword.hp = 25

const swipe = new Action()
swipe.name = 'swipe'
swipe.actionType.setAttack()
swipe.effect.effectType.setDamage()
swipe.effect.baseValue = 20
swipe.effect.randomValue = 10

sword.actions.push(swipe)

/* 
Item - cure wounds
    Action - heal
*/
const cureWounds = new Item()
cureWounds.name = 'cure wounds'
cureWounds.hp = 25

const heal = new Action()
heal.name = 'heal'
heal.actionType.setSpecial()
heal.effect.effectType.setHeal()
heal.effect.baseValue = 20
heal.effect.randomValue = 20

cureWounds.actions.push(heal)

/* Add Items */

player.activeItems.push(shield)
player.activeItems.push(sword)
player.activeItems.push(cureWounds)

/* Initialize Health *needs to happen after items* */

player.setTotalHealth()

export default player






