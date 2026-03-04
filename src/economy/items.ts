export type ItemType = 'material' | 'valuable';

export type ItemDef = { name: string; description: string; type: ItemType };

export const ITEMS: Record<string, ItemDef> = {
    rat_tail:           { name: 'Rat Tail',           description: 'A severed rat tail.',                               type: 'valuable'  },
    copper_scraps:      { name: 'Copper Scraps',      description: 'Bent copper scraps salvaged from the undead.',      type: 'material'  },
    enchanting_crystal: { name: 'Enchanting Crystal', description: 'A faintly glowing crystal with arcane energy.',     type: 'material'  },
    spores:             { name: 'Spores',             description: 'Fine spores shaken loose from a mushroom.',         type: 'valuable'  },
    wood_plank:         { name: 'Wood Plank',         description: 'A rough plank of wood, broken off from a mushroom stalk.', type: 'material' },
};
