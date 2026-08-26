/**
 * Working the land: felling trees and clearing the stumps they leave.
 *
 * What you can do is decided by what you are carrying. There is no separate
 * tool slot, and there does not need to be one: an axe is already a thing a
 * character owns and equips, and making land-clearing use it means the same
 * choice matters in two places rather than adding a second inventory.
 */

/** Weapons that will fell a tree. */
export const CHOP_TOOLS = new Set(['axe_wood', 'battle_axe']);

/** Weapons that will get a stump out of the ground. */
export const DIG_TOOLS = new Set(['shovel_wood']);

export type Labour = 'chop' | 'dig';

/** Anything whose sprite names a stump is a stump, however it came to be one. */
export const isStump = (sprite: string): boolean => sprite.endsWith('_stump');

/** A standing tree: more than one sprite tall, or a single tree part upright. */
export function isStandingTree(stack: string[]): boolean {
  if (stack.length > 1) return true;
  const only = stack[0] ?? '';
  return only.startsWith('dec_tree_') && !isStump(only);
}

/**
 * What this tool does to this thing, or null if nothing.
 *
 * Deliberately narrow. An axe does not dig and a shovel does not fell, so
 * clearing a patch of wood takes both, which is the point: it is work a group
 * splits up rather than one person with one tool.
 */
export function labourFor(weaponKey: string, stack: string[]): Labour | null {
  if (isStandingTree(stack) && CHOP_TOOLS.has(weaponKey)) return 'chop';
  if (stack.length === 1 && isStump(stack[0]) && DIG_TOOLS.has(weaponKey)) return 'dig';
  return null;
}

/** What a player would need in hand to make progress on this thing. */
export function toolNeededFor(stack: string[]): string | null {
  if (isStandingTree(stack)) return 'an axe';
  if (stack.length === 1 && isStump(stack[0])) return 'a shovel';
  return null;
}
