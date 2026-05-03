export type ItemType = 'material' | 'consumable';

export type ItemDef = { name: string; description: string; type: ItemType };

export const ITEMS: Record<string, ItemDef> = {
    brain:         { name: 'Brain',         description: 'A grotesque brain pulsing with latent energy. Used in enchanting.',           type: 'material'   },
    broken_sword:  { name: 'Broken Sword',  description: 'A rusted, broken sword. A smith could reforge this into something useful.',   type: 'material'   },
    broken_knife:  { name: 'Broken Knife',  description: 'A chipped and broken knife. Good salvage material for a smith.',              type: 'material'   },
    spores:        { name: 'Spores',        description: 'Fine spores collected from a mushroom creature. Useful for enchanting.',      type: 'material'   },
    monster_bait:  { name: 'Monster Bait',  description: 'Lures monsters out of the forest surrounding Sulku\'it. One use per battle.', type: 'consumable' },
};
