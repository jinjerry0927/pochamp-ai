import { Dex as BaseDex } from '@pkmn/dex';
import { regulationMB } from './generated/regulation-mb.js';
import type { StatBlock, TeamPokemon } from './types.js';

const Dex = BaseDex.forGen(9);
export const toID = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

interface LearnsetSnapshot {
  learnset?: Record<string, unknown>;
}

export interface SpeciesSnapshot {
  id: string;
  name: string;
  nationalDex: number;
  types: string[];
  abilities: string[];
  baseStats: StatBlock;
  exists: boolean;
}

export interface MoveSnapshot {
  id: string;
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  power: number;
  accuracy: number;
  priority: number;
  exists: boolean;
}

export interface SpeciesBuilderOptions {
  species: string;
  abilities: string[];
  moves: string[];
  megaEligible: boolean;
}

export interface StatAlignmentOption {
  id: string;
  raised: string | null;
  lowered: string | null;
}

export const statAlignmentOptions: StatAlignmentOption[] = [
  { id: 'Lonely', raised: '공격', lowered: '방어' },
  { id: 'Adamant', raised: '공격', lowered: '특공' },
  { id: 'Naughty', raised: '공격', lowered: '특방' },
  { id: 'Brave', raised: '공격', lowered: '스피드' },
  { id: 'Bold', raised: '방어', lowered: '공격' },
  { id: 'Impish', raised: '방어', lowered: '특공' },
  { id: 'Lax', raised: '방어', lowered: '특방' },
  { id: 'Relaxed', raised: '방어', lowered: '스피드' },
  { id: 'Modest', raised: '특공', lowered: '공격' },
  { id: 'Mild', raised: '특공', lowered: '방어' },
  { id: 'Rash', raised: '특공', lowered: '특방' },
  { id: 'Quiet', raised: '특공', lowered: '스피드' },
  { id: 'Calm', raised: '특방', lowered: '공격' },
  { id: 'Gentle', raised: '특방', lowered: '방어' },
  { id: 'Careful', raised: '특방', lowered: '특공' },
  { id: 'Sassy', raised: '특방', lowered: '스피드' },
  { id: 'Timid', raised: '스피드', lowered: '공격' },
  { id: 'Hasty', raised: '스피드', lowered: '방어' },
  { id: 'Jolly', raised: '스피드', lowered: '특공' },
  { id: 'Naive', raised: '스피드', lowered: '특방' },
  { id: 'Serious', raised: null, lowered: null },
];

const allowedMoveIds = new Set(regulationMB.allowedMoves.map((move) => toID(move)));
const allowedItemIds = new Set(regulationMB.allowedItems.map((item) => toID(item)));
const learnsetCache = new Map<string, LearnsetSnapshot>();

async function loadRegulationLearnsets(): Promise<void> {
  const names = new Set<string>();
  for (const entry of regulationMB.eligibleSpecies) {
    let species = Dex.species.get(entry.name);
    const visited = new Set<string>();
    while (species.exists && !visited.has(species.id)) {
      visited.add(species.id);
      names.add(species.name);
      const parent = species.changesFrom || (species.baseSpecies !== species.name ? species.baseSpecies : undefined);
      if (!parent) break;
      species = Dex.species.get(parent);
    }
  }

  await Promise.all([...names].map(async (name) => {
    const species = Dex.species.get(name);
    const data = await Dex.learnsets.get(name);
    if (species.exists && data?.exists) learnsetCache.set(species.id, { learnset: data.learnset });
  }));
}

await loadRegulationLearnsets();

const asStats = (stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }): StatBlock => ({
  hp: stats.hp,
  attack: stats.atk,
  defense: stats.def,
  specialAttack: stats.spa,
  specialDefense: stats.spd,
  speed: stats.spe,
});

export function getSpecies(name: string): SpeciesSnapshot | null {
  const species = Dex.species.get(name);
  if (!species.exists) return null;
  return {
    id: species.id,
    name: species.name,
    nationalDex: species.num,
    types: [...species.types],
    abilities: Object.values(species.abilities).filter((value): value is string => typeof value === 'string'),
    baseStats: asStats(species.baseStats),
    exists: species.exists,
  };
}

export function getMove(name: string): MoveSnapshot | null {
  const move = Dex.moves.get(name);
  if (!move.exists) return null;
  const accuracy = move.accuracy === true ? 100 : move.accuracy;
  return {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.basePower,
    accuracy,
    priority: move.priority,
    exists: move.exists,
  };
}

export function getItemExists(name: string): boolean {
  return !name || allowedItemIds.has(toID(name));
}

export function isAbilityAvailable(pokemon: TeamPokemon): boolean {
  const species = Dex.species.get(pokemon.species);
  if (!species.exists) return false;
  const wanted = toID(pokemon.ability);
  return Object.values(species.abilities).some((ability) => toID(ability) === wanted);
}

export function canLearnMove(speciesName: string, moveName: string): boolean | null {
  try {
    let species = Dex.species.get(speciesName);
    const move = Dex.moves.get(moveName);
    if (!species.exists || !move.exists || !allowedMoveIds.has(move.id)) return false;
    const visited = new Set<string>();
    let foundLearnset = false;
    while (species.exists && !visited.has(species.id)) {
      visited.add(species.id);
      const data = learnsetCache.get(species.id);
      if (data?.learnset) {
        foundLearnset = true;
        if (move.id in data.learnset) return true;
      }
      const parent = species.changesFrom || (species.baseSpecies !== species.name ? species.baseSpecies : undefined);
      if (!parent) break;
      species = Dex.species.get(parent);
    }
    return foundLearnset ? false : null;
  } catch {
    return null;
  }
}

export function getSpeciesBuilderOptions(speciesName: string): SpeciesBuilderOptions {
  let species = Dex.species.get(speciesName);
  if (!species.exists) return { species: speciesName, abilities: [], moves: [], megaEligible: false };
  const original = species;
  const abilities = Object.values(species.abilities).filter((ability): ability is string => typeof ability === 'string');
  const visited = new Set<string>();
  const moveIds = new Set<string>();
  while (species.exists && !visited.has(species.id)) {
    visited.add(species.id);
    const data = learnsetCache.get(species.id);
    for (const moveId of Object.keys(data?.learnset ?? {})) {
      if (allowedMoveIds.has(moveId)) moveIds.add(moveId);
    }
    const parent = species.changesFrom || (species.baseSpecies !== species.name ? species.baseSpecies : undefined);
    if (!parent) break;
    species = Dex.species.get(parent);
  }
  const baseId = toID(original.baseSpecies || original.name);
  return {
    species: original.name,
    abilities,
    moves: [...moveIds].map((moveId) => Dex.moves.get(moveId).name).filter(Boolean).sort((left, right) => left.localeCompare(right)),
    megaEligible: regulationMB.allowedMegas.some((mega) => toID(mega).startsWith(`${baseId}mega`)),
  };
}

export function regulationItems(): string[] {
  return [...regulationMB.allowedItems];
}

export function typeMultiplier(moveType: string, defenderName: string): number {
  const defender = Dex.species.get(defenderName);
  if (!defender.exists || !Dex.getImmunity(moveType, defender)) return 0;
  return 2 ** Dex.getEffectiveness(moveType, defender);
}

export function regulationSpecies(): Array<{ id: string; name: string; nationalDex: number; supported: boolean }> {
  return regulationMB.eligibleSpecies.map((entry) => ({
    ...entry,
    supported: Dex.species.get(entry.name).exists,
  }));
}

export function searchDex(kind: 'species' | 'move' | 'ability' | 'item', query = '', limit = 50): string[] {
  const needle = toID(query);
  const all = kind === 'species'
    ? regulationSpecies().map((entry) => entry.name)
    : kind === 'move'
      ? [...regulationMB.allowedMoves]
      : kind === 'ability'
        ? Dex.abilities.all().filter((entry) => entry.exists && !entry.isNonstandard).map((entry) => entry.name)
        : [...regulationMB.allowedItems];
  return all.filter((name) => !needle || toID(name).includes(needle)).slice(0, limit);
}

export function neutralLevel50Stats(speciesName: string): StatBlock | null {
  const species = getSpecies(speciesName);
  if (!species) return null;
  return {
    hp: species.baseStats.hp * 2 + 110,
    attack: species.baseStats.attack * 2 + 5,
    defense: species.baseStats.defense * 2 + 5,
    specialAttack: species.baseStats.specialAttack * 2 + 5,
    specialDefense: species.baseStats.specialDefense * 2 + 5,
    speed: species.baseStats.speed * 2 + 5,
  };
}

export { regulationMB };
