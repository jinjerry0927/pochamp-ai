import { Dex as BaseDex } from '@pkmn/dex';
import { localizationKo } from './generated/localization-ko.js';
import { regulationMBMeta } from './generated/meta-mb.js';
import { regulationMB } from './generated/regulation-mb.js';
import type { StatBlock, StatPointBlock, TeamPokemon } from './types.js';

const Dex = BaseDex.forGen(9);
export const toID = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

interface LearnsetSnapshot {
  learnset?: Record<string, unknown>;
}

export interface SpeciesSnapshot {
  id: string;
  name: string;
  displayName: string;
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
  displayName: string;
  baseStats: StatBlock;
  abilities: string[];
  moves: string[];
  megaEligible: boolean;
  usage: SpeciesUsageSnapshot;
}

export interface UsageValue { name: string; usage: number }
export interface SpeciesUsageSnapshot {
  rank: number | null;
  moves: UsageValue[];
  abilities: UsageValue[];
  items: UsageValue[];
  statAlignments: UsageValue[];
}

export type LocalizedNameKind = 'species' | 'move' | 'ability' | 'item' | 'nature';

export interface StatAlignmentOption {
  id: string;
  raised: string | null;
  lowered: string | null;
  raisedStat: keyof StatBlock | null;
  loweredStat: keyof StatBlock | null;
}

const alignment = (id: string, raisedStat: keyof StatBlock | null, loweredStat: keyof StatBlock | null): StatAlignmentOption => {
  const labels: Record<keyof StatBlock, string> = { hp: 'HP', attack: '공격', defense: '방어', specialAttack: '특공', specialDefense: '특방', speed: '스피드' };
  return { id, raisedStat, loweredStat, raised: raisedStat ? labels[raisedStat] : null, lowered: loweredStat ? labels[loweredStat] : null };
};

export const statAlignmentOptions: StatAlignmentOption[] = [
  alignment('Lonely', 'attack', 'defense'), alignment('Adamant', 'attack', 'specialAttack'),
  alignment('Naughty', 'attack', 'specialDefense'), alignment('Brave', 'attack', 'speed'),
  alignment('Bold', 'defense', 'attack'), alignment('Impish', 'defense', 'specialAttack'),
  alignment('Lax', 'defense', 'specialDefense'), alignment('Relaxed', 'defense', 'speed'),
  alignment('Modest', 'specialAttack', 'attack'), alignment('Mild', 'specialAttack', 'defense'),
  alignment('Rash', 'specialAttack', 'specialDefense'), alignment('Quiet', 'specialAttack', 'speed'),
  alignment('Calm', 'specialDefense', 'attack'), alignment('Gentle', 'specialDefense', 'defense'),
  alignment('Careful', 'specialDefense', 'specialAttack'), alignment('Sassy', 'specialDefense', 'speed'),
  alignment('Timid', 'speed', 'attack'), alignment('Hasty', 'speed', 'defense'),
  alignment('Jolly', 'speed', 'specialAttack'), alignment('Naive', 'speed', 'specialDefense'),
  alignment('Serious', null, null),
];

const allowedMoveIds = new Set(regulationMB.allowedMoves.map((move) => toID(move)));
const allowedItemIds = new Set(regulationMB.allowedItems.map((item) => toID(item)));
const learnsetCache = new Map<string, LearnsetSnapshot>();

const localizationMaps: Record<LocalizedNameKind, Readonly<Record<string, string>>> = {
  species: localizationKo.species,
  move: localizationKo.moves,
  ability: localizationKo.abilities,
  item: localizationKo.items,
  nature: localizationKo.natures,
};

export function localizeName(kind: LocalizedNameKind, value: string): string {
  return localizationMaps[kind][toID(value)] ?? value;
}

const koreanCompare = (left: string, right: string): number => left.localeCompare(right, 'ko-KR');

function metaForSpecies(speciesName: string): SpeciesUsageSnapshot {
  const raw = (regulationMBMeta.species as unknown as Record<string, {
    rank: number;
    moves: ReadonlyArray<UsageValue>;
    abilities: ReadonlyArray<UsageValue>;
    items: ReadonlyArray<UsageValue>;
    statAlignments: ReadonlyArray<UsageValue>;
  }>)[toID(speciesName)];
  return raw ? {
    rank: raw.rank,
    moves: [...raw.moves],
    abilities: [...raw.abilities],
    items: [...raw.items],
    statAlignments: [...raw.statAlignments],
  } : { rank: null, moves: [], abilities: [], items: [], statAlignments: [] };
}

export function sortByUsage(values: string[], usage: UsageValue[], kind: LocalizedNameKind): string[] {
  const weights = new Map(usage.map((entry) => [toID(entry.name), entry.usage]));
  return [...values].sort((left, right) => {
    const usageDifference = (weights.get(toID(right)) ?? -1) - (weights.get(toID(left)) ?? -1);
    return usageDifference || koreanCompare(localizeName(kind, left), localizeName(kind, right));
  });
}

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
    displayName: localizeName('species', species.name),
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
    if (metaForSpecies(species.name).moves.some((entry) => toID(entry.name) === move.id)) return true;
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
  if (!species.exists) return {
    species: speciesName,
    displayName: speciesName,
    baseStats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    abilities: [], moves: [], megaEligible: false, usage: metaForSpecies(speciesName),
  };
  const original = species;
  const abilities = Object.values(species.abilities).filter((ability): ability is string => typeof ability === 'string');
  const usage = metaForSpecies(original.name);
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
  for (const entry of usage.moves) {
    const move = Dex.moves.get(entry.name);
    if (move.exists && allowedMoveIds.has(move.id)) moveIds.add(move.id);
  }
  const baseId = toID(original.baseSpecies || original.name);
  return {
    species: original.name,
    displayName: localizeName('species', original.name),
    baseStats: asStats(original.baseStats),
    abilities: sortByUsage(abilities, usage.abilities, 'ability'),
    moves: sortByUsage([...moveIds].map((moveId) => Dex.moves.get(moveId).name).filter(Boolean), usage.moves, 'move'),
    megaEligible: regulationMB.allowedMegas.some((mega) => toID(mega).startsWith(`${baseId}mega`)),
    usage,
  };
}

export function regulationItems(): string[] {
  return [...regulationMB.allowedItems].sort((left, right) => koreanCompare(localizeName('item', left), localizeName('item', right)));
}

export function typeMultiplier(moveType: string, defenderName: string): number {
  const defender = Dex.species.get(defenderName);
  if (!defender.exists || !Dex.getImmunity(moveType, defender)) return 0;
  return 2 ** Dex.getEffectiveness(moveType, defender);
}

export function regulationSpecies(): Array<{ id: string; name: string; displayName: string; nationalDex: number; supported: boolean }> {
  return regulationMB.eligibleSpecies.map((entry) => ({
    ...entry,
    displayName: localizeName('species', entry.name),
    supported: Dex.species.get(entry.name).exists,
  }));
}

export function searchDex(kind: 'species' | 'move' | 'ability' | 'item', query = '', limit = 50): string[] {
  const needle = query.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s\-_.]/g, '');
  const all = kind === 'species'
    ? regulationSpecies().map((entry) => entry.name)
    : kind === 'move'
      ? [...regulationMB.allowedMoves]
      : kind === 'ability'
        ? Dex.abilities.all().filter((entry) => entry.exists && !entry.isNonstandard).map((entry) => entry.name)
        : [...regulationMB.allowedItems];
  const localizationKind = kind === 'species' ? 'species' : kind === 'move' ? 'move' : kind === 'ability' ? 'ability' : 'item';
  return all
    .filter((name) => !needle || `${toID(name)}${localizeName(localizationKind, name).normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s\-_.()]/g, '')}`.includes(needle))
    .sort((left, right) => koreanCompare(localizeName(localizationKind, left), localizeName(localizationKind, right)))
    .slice(0, limit);
}

export function calculateLevel50Stats(speciesName: string, statPoints: StatPointBlock, statAlignment: string): StatBlock | null {
  const species = getSpecies(speciesName);
  if (!species) return null;
  const selectedAlignment = statAlignmentOptions.find((entry) => entry.id === statAlignment) ?? statAlignmentOptions.at(-1)!;
  const adjusted = (stat: Exclude<keyof StatBlock, 'hp'>): number => {
    const multiplier = selectedAlignment.raisedStat === stat ? 1.1 : selectedAlignment.loweredStat === stat ? 0.9 : 1;
    return Math.floor((species.baseStats[stat] + 20 + statPoints[stat]) * multiplier);
  };
  return {
    hp: species.baseStats.hp + 75 + statPoints.hp,
    attack: adjusted('attack'),
    defense: adjusted('defense'),
    specialAttack: adjusted('specialAttack'),
    specialDefense: adjusted('specialDefense'),
    speed: adjusted('speed'),
  };
}

export function neutralLevel50Stats(speciesName: string): StatBlock | null {
  return calculateLevel50Stats(speciesName, { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 }, 'Serious');
}

export function inferStatPoints(speciesName: string, stats: StatBlock, statAlignment: string): { points: StatPointBlock; exact: boolean } | null {
  const species = getSpecies(speciesName);
  if (!species) return null;
  const keys: Array<keyof StatBlock> = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
  const points = Object.fromEntries(keys.map((stat) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let value = 0; value <= 32; value += 1) {
      const candidate = calculateLevel50Stats(speciesName, {
        hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, [stat]: value,
      }, statAlignment)![stat];
      const distance = Math.abs(candidate - stats[stat]);
      if (distance < bestDistance) { best = value; bestDistance = distance; }
    }
    return [stat, best];
  })) as StatPointBlock;
  const calculated = calculateLevel50Stats(speciesName, points, statAlignment)!;
  const total = Object.values(points).reduce((sum, value) => sum + value, 0);
  return { points, exact: total <= 66 && keys.every((stat) => calculated[stat] === stats[stat]) };
}

export { regulationMB };
export { localizationKo, regulationMBMeta };
