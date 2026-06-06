export type ItemType = 'material' | 'valuable' | 'consumable' | 'unlock';

// Items of type 'unlock' are permanent — once a character owns one, the
// quantity is always 1 and they can't sell, trade, give away, or consume it.
// They're typically issued by NPCs/shops to gate access to content (hunting a
// specific enemy, entering a place, etc.). Hunt start checks the bait type
// and skips consumption if it's an unlock.
export function isUnlock(itemId: string): boolean {
  return ITEMS[itemId]?.type === 'unlock';
}

export type ItemDef = { name: string; description: string; type: ItemType };

export const ITEMS: Record<string, ItemDef> = {
    // Raw materials — dropped by enemies, sold at profession shops
    crude_talamite:  { name: 'Crude Talamite',  description: 'Rough crystalline ore pulled from the earth. A blacksmith can smelt this into something useful.',     type: 'material'   },
    sulwood:         { name: 'Sulwood',          description: 'Raw lumber from the sulfolk groves. A lumberjack can work this into components.',                   type: 'material'   },
    thuvel:          { name: 'Thuvel',           description: 'Shimmering arcane dust shed by enchanted creatures. An enchanter can distill this into hiruos.',     type: 'material'   },

    // Crafted intermediates — profession-only, not sold in shops
    treated_sulwood: { name: 'Treated Sulwood',  description: 'Sulwood cured with resin and heat. Denser and more workable than the raw form.',                    type: 'material'   },
    talamite:        { name: 'Talamite',         description: 'Refined talamite ingots. Smelted from crude ore by a blacksmith.',                                  type: 'material'   },
    hiruos:          { name: 'Hiruos',           description: 'Distilled arcane essence. An enchanter refines this from thuvel.',                                  type: 'material'   },
    hardwood:        { name: 'Hardwood',         description: 'Press-cured treated sulwood. Dense, durable, and difficult to work without skill.',                 type: 'material'   },
    alloy:           { name: 'Alloy',            description: 'A superior metal fused from talamite under extreme heat. Only the best blacksmiths can produce it.',type: 'material'   },
    nodol:           { name: 'Nodol',            description: 'Crystallized hiruos. Rare and precisely attuned — the finest enchanting material.',                 type: 'material'   },

    // Weapon components — crafted, sold at profession shops
    sword_hilt:           { name: 'Sword Hilt',           description: 'A wrapped sulwood hilt, ready to receive a blade.',                       type: 'material' },
    axe_handle:           { name: 'Axe Handle',           description: 'A thick sulwood handle, balanced for a heavy head.',                      type: 'material' },
    shovel_handle:        { name: 'Shovel Handle',        description: 'A sturdy sulwood handle, ready for a blade.',                             type: 'material' },
    sword_blade_wood:     { name: 'Sword Blade (Wood)',   description: 'A hardened sulwood blade, shaped and edged for cutting.',                 type: 'material' },
    axe_head_wood:        { name: 'Axe Head (Wood)',      description: 'A rough-hewn sulwood axe head, edged and hardened.',                     type: 'material' },
    shovel_head_wood:     { name: 'Shovel Head (Wood)',   description: 'A shaped sulwood blade, ready to be fitted to a handle.',                 type: 'material' },
    wand_base_wood:       { name: 'Wand Base (Wood)',     description: 'A slender sulwood rod, blank until attuned by an enchanter.',             type: 'material' },
    sword_blade_hardwood: { name: 'Sword Blade (Hardwood)', description: 'A hardwood blade — denser grain, holds a finer edge.',                 type: 'material' },
    axe_head_hardwood:    { name: 'Axe Head (Hardwood)',  description: 'A hardwood axe head — heavier and better balanced than treated sulwood.', type: 'material' },
    shovel_head_hardwood: { name: 'Shovel Head (Hardwood)', description: 'A hardwood shovel blade — sturdier and better balanced.',              type: 'material' },
    wand_base_hardwood:   { name: 'Wand Base (Hardwood)', description: 'A hardwood wand rod — denser grain, holds attunement more cleanly.',     type: 'material' },
    sword_blade_talamite: { name: 'Sword Blade (Talamite)', description: 'A talamite blade, edged and ready for a hilt.',                       type: 'material' },
    axe_head_talamite:    { name: 'Axe Head (Talamite)',  description: 'A talamite axe head — takes an edge sulwood never could.',               type: 'material' },
    shovel_head_talamite: { name: 'Shovel Head (Talamite)', description: 'A talamite shovel blade — stays sharp no matter the abuse.',           type: 'material' },
    wand_base_talamite:   { name: 'Wand Base (Talamite)', description: 'A rod of talamite, cold and dense. Blank until attuned by an enchanter.',type: 'material' },
    sword_blade_alloy:    { name: 'Sword Blade (Alloy)',  description: 'An alloy blade — holds an edge far longer than talamite.',               type: 'material' },
    axe_head_alloy:       { name: 'Axe Head (Alloy)',     description: 'An alloy axe head — weight and edge in perfect balance.',                type: 'material' },
    shovel_head_alloy:    { name: 'Shovel Head (Alloy)',  description: 'An alloy shovel blade — sharper and more durable than talamite.',        type: 'material' },
    wand_base_alloy:      { name: 'Wand Base (Alloy)',    description: 'A rod of refined alloy. Channels arcane energy with exceptional precision.', type: 'material' },

    // Bait — consumed to start a battle, bought at the general store
    swallow_bait: { name: 'Swallow Bait',  description: 'A handful of breadcrumbs and river stones, gifted by Dolan. Hand it to a swallow and it follows you — every time. Always-on permit to hunt lithkem swallows.', type: 'unlock' },
    sulfolk_bait: { name: 'Sulfolk Bait',  description: 'A bundle of fresh-cut branches. Sulfolk can\'t resist investigating.',                  type: 'consumable' },
    wyrm_bait:    { name: 'Wyrm Bait',     description: 'A chunk of raw talamite ore. Talwyrm are drawn to the mineral scent.',                  type: 'consumable' },
    deer_bait:    { name: 'Deer Bait',     description: 'A pouch of dried herbs from the forest floor. Daefen deer follow the smell for miles.', type: 'consumable' },
    toad_bait:    { name: 'Toad Bait',     description: 'A jar of murky pond water. Maetoads surface when they smell their own.',                type: 'consumable' },
    bear_bait:    { name: 'Bear Bait',     description: 'A bloody slab of game wrapped in waxed cloth. A melbear can smell it from a den away.', type: 'consumable' },
    tar_bait:     { name: 'Tar Bait',      description: 'A pungent slick of black resin. Golnosar nest in tar pools and rise when they smell their own.', type: 'consumable' },
    tin_bait:     { name: 'Tin Bait',      description: 'A rattling pouch of polished tin shavings. Tinpul mistake the sound for one of their own.', type: 'consumable' },

    // Misc materials sold at the general store
    card_deck:    { name: 'Card Deck',     description: 'A simple deck of cards with the Chae emperor, Gustavus, as the king. Common in town, occasionally enchanted by those who know how.', type: 'material'   },

    // Valuables — dropped by enemies, sold at shops
    swallow_feather: { name: 'Swallow Feather', description: 'A sleek feather from a lithkem swallow. Light and iridescent.',                   type: 'valuable'   },
    venison:         { name: 'Venison',         description: 'Fresh meat from a daefen deer. Worth good korel at the general store.',           type: 'valuable'   },
    maek_egg:        { name: 'Maek Egg',        description: 'A maetoad egg, pooling with Maek. Warm to the touch.',                           type: 'valuable'   },
    crystal_tooth:   { name: 'Crystal Tooth',   description: 'A crystallized tooth shed by a talwyrm. Dense and faintly luminous.',             type: 'valuable'   },
    felt_hat:        { name: 'Felt Hat',        description: 'A wide-brimmed felt hat. Someone left it in the woods.',                         type: 'valuable'   },
    antler_trophy:   { name: 'Antler Trophy',   description: 'A full rack of burning antlers from a daefen deer. Impressive wall art.',         type: 'valuable'   },
    melstone:        { name: 'Melstone',        description: 'A dense, polished stone passed through a melbear\'s gut and worn smooth. The blacksmith uses them as heat-resistant cores.', type: 'valuable'   },
    bear_paw:        { name: 'Bear Paw',        description: 'A massive melbear paw, fur and claws intact. The lumberjack pays well for one.',  type: 'valuable'   },
    bottle_of_tar:   { name: 'Bottle of Tar',   description: 'A glass bottle of black, oily resin drained from a golnosar. The lumberjack uses it for waterproofing tools.', type: 'valuable'   },
    lifgem:          { name: 'Lifgem',          description: 'A faintly pulsing gemstone. The enchanter pays for any that come through the door.', type: 'valuable'   },

    // Enemy trophies — permanent character-bound mementos granted on the
    // first defeat of each enemy. The defeated-count shown on each is queried
    // live from BattleLog, not stored on the item. Map enemy_key → trophy_id
    // is just `${enemy_key}_trophy`.
    lithkem_swallow_trophy: { name: 'Swallow Trophy', description: 'A bronzed feather from your first lithkem swallow kill.',                  type: 'unlock' },
    sulfolk_trophy:         { name: 'Sulfolk Trophy', description: 'A dried husk pulled from a fallen sulfolk. The plant matter still moves a little.', type: 'unlock' },
    talwyrm_trophy:         { name: 'Talwyrm Trophy', description: 'A polished crystal tooth, mounted on a worn cord.',                       type: 'unlock' },
    daefen_deer_trophy:     { name: 'Daefen Deer Trophy', description: 'A small ember of antler — the fire never quite went out.',           type: 'unlock' },
    maetoad_trophy:         { name: 'Maetoad Trophy', description: 'A dried Maek-gland on a leather thong. Still faintly warm.',              type: 'unlock' },
    golnosar_trophy:        { name: 'Golnosar Trophy', description: 'A sliver of hardened tar, pressed into the shape of a coin.',            type: 'unlock' },
    melbear_trophy:         { name: 'Melbear Trophy', description: 'A single claw from a melbear, wrapped at the base in dyed sinew.',        type: 'unlock' },
    tinpul_trophy:          { name: 'Tinpul Trophy', description: 'A flattened scrap of tin, beaten thin enough to wear.',                    type: 'unlock' },
};

// Convention used by the trophy grant + inventory enrichment paths.
export function trophyIdFor(enemyKey: string): string { return `${enemyKey}_trophy`; }
export function enemyKeyFromTrophy(trophyId: string): string | null {
  return trophyId.endsWith('_trophy') ? trophyId.slice(0, -'_trophy'.length) : null;
}
