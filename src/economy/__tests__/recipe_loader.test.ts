import { loadAllRecipes } from '../recipe_loader.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'idya-recipes-'));
}

const FIXTURE_YAML = `
recipes:
  - id: lj_quarterstaff
    name: Quarterstaff
    description: Shape a long, balanced length of sulwood into a fighting staff.
    profession: lumberjack
    required_level: 1
    ingredients:
      - item_id: sulwood
        quantity: 4
    output:
      type: weapon
      id: quarterstaff

  - id: bs_talamite_ingot
    name: Talamite Ingot
    profession: blacksmith
    required_level: 1
    ingredients:
      - item_id: talamite_ore
        quantity: 3
    output:
      type: item
      id: talamite_ingot
      quantity: 1
`;

describe('loadAllRecipes', () => {
  test('returns empty array for nonexistent directory', () => {
    expect(loadAllRecipes('/nonexistent/path/xyz')).toEqual([]);
  });

  test('returns empty array for empty directory', () => {
    const dir = tempDir();
    expect(loadAllRecipes(dir)).toEqual([]);
    fs.rmdirSync(dir);
  });

  test('loads all recipes from a yaml file', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'test.yaml'), FIXTURE_YAML);
    const recipes = loadAllRecipes(dir);
    fs.rmSync(dir, { recursive: true });

    expect(recipes).toHaveLength(2);
  });

  test('recipe fields parse correctly', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'test.yaml'), FIXTURE_YAML);
    const recipes = loadAllRecipes(dir);
    fs.rmSync(dir, { recursive: true });

    const qs = recipes.find(r => r.id === 'lj_quarterstaff')!;
    expect(qs.name).toBe('Quarterstaff');
    expect(qs.profession).toBe('lumberjack');
    expect(qs.required_level).toBe(1);
    expect(qs.ingredients).toEqual([{ item_id: 'sulwood', quantity: 4 }]);
    expect(qs.output).toEqual({ type: 'weapon', id: 'quarterstaff', quantity: undefined });
  });

  test('optional output quantity is loaded when present', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'test.yaml'), FIXTURE_YAML);
    const recipes = loadAllRecipes(dir);
    fs.rmSync(dir, { recursive: true });

    const ingot = recipes.find(r => r.id === 'bs_talamite_ingot')!;
    expect(ingot.output.quantity).toBe(1);
  });

  test('ignores non-yaml files', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'test.yaml'), FIXTURE_YAML);
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a recipe');
    const recipes = loadAllRecipes(dir);
    fs.rmSync(dir, { recursive: true });

    expect(recipes).toHaveLength(2);
  });

  test('merges recipes across multiple yaml files', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'a.yaml'), FIXTURE_YAML);
    fs.writeFileSync(path.join(dir, 'b.yaml'), FIXTURE_YAML);
    const recipes = loadAllRecipes(dir);
    fs.rmSync(dir, { recursive: true });

    expect(recipes).toHaveLength(4);
  });
});
