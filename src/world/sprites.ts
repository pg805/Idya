/**
 * How many squares a sprite covers.
 *
 * Anything not listed is one square. Mirrors the table in public/terrain.js,
 * which is where drawing happens; this copy exists because the server has to
 * answer the same question for collision, and shipping the renderer's module
 * to the server to ask it would be worse than nine lines repeated.
 */
export const SPRITE_SIZE: Record<string, [number, number]> = {
  bld_house_01: [2, 2], bld_shed_01: [1, 2], bld_smithy_01: [2, 2],
  bld_house_02: [2, 2], bld_house_back_02: [2, 2],
  bld_tent_01: [2, 2], bld_tent_02: [2, 2],
  bld_tent_03: [2, 2], bld_tent_04: [2, 2],
};

export const sizeOf = (sprite: string): [number, number] => SPRITE_SIZE[sprite] ?? [1, 1];

/**
 * Things you walk over rather than around.
 *
 * Ground detail: flowers, crops, tufts, shells, and the stump left where a tree
 * used to be. A stump is deliberately in here. It marks work still to do rather
 * than blocking the square, and a half-cleared patch you cannot cross would
 * make clearing land worse the further you got.
 */
export function isWalkableSprite(sprite: string): boolean {
  return /^(ov_|dec_(flower|crop|shell|grass|reed))/.test(sprite) || sprite.endsWith('_stump');
}
