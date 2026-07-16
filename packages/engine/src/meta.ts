import { localizeName } from './dex.js';
import type { TeamPokemon } from './types.js';

export type ArchetypeId = 'rain' | 'sun' | 'sand' | 'snow' | 'trick-room';

export interface TeamArchetype {
  id: ArchetypeId;
  name: string;
  confidence: 'high' | 'medium';
  setters: string[];
  abusers: string[];
  evidence: string[];
}

interface ArchetypeDefinition {
  id: ArchetypeId;
  name: string;
  setters: readonly string[];
  abusers: readonly string[];
}

const archetypes: readonly ArchetypeDefinition[] = [
  {
    id: 'rain', name: '비 파티',
    setters: ['Pelipper', 'Politoed', 'Kyogre'],
    abusers: ['Swampert', 'Archaludon', 'Basculegion', 'Kingdra', 'Ludicolo', 'Barraskewda'],
  },
  {
    id: 'sun', name: '쾌청 파티',
    setters: ['Torkoal', 'Ninetales', 'Groudon'],
    abusers: ['Venusaur', 'Charizard', 'Lilligant', 'Lilligant-Hisui', 'Walking Wake'],
  },
  {
    id: 'sand', name: '모래바람 파티',
    setters: ['Tyranitar', 'Hippowdon'],
    abusers: ['Garchomp', 'Excadrill', 'Lycanroc', 'Dracozolt'],
  },
  {
    id: 'snow', name: '설경 파티',
    setters: ['Ninetales-Alola', 'Abomasnow'],
    abusers: ['Baxcalibur', 'Cetitan', 'Glaceon', 'Froslass'],
  },
  {
    id: 'trick-room', name: '트릭룸 파티',
    setters: ['Sinistcha', 'Farigiraf', 'Porygon2', 'Hatterene', 'Cresselia', 'Indeedee-F'],
    abusers: ['Ursaluna', 'Torkoal', 'Rhyperior', 'Armarouge', 'Hariyama', 'Snorlax'],
  },
] as const;

const unique = (values: string[]) => [...new Set(values)];

export function detectTeamArchetypes(species: readonly string[]): TeamArchetype[] {
  const roster = new Set(species);
  return archetypes.flatMap((definition) => {
    const setters = definition.setters.filter((name) => roster.has(name));
    const abusers = definition.abusers.filter((name) => roster.has(name));
    const confidence = setters.length > 0 && abusers.length > 0
      ? 'high' as const
      : setters.length > 0 || abusers.length >= 2
        ? 'medium' as const
        : null;
    if (!confidence) return [];
    return [{
      id: definition.id,
      name: definition.name,
      confidence,
      setters,
      abusers,
      evidence: unique([...setters, ...abusers]).map((name) => localizeName('species', name)),
    }];
  });
}

export function archetypeSelectionBonus(members: readonly TeamPokemon[], detected: readonly TeamArchetype[]): number {
  const selected = new Set(members.map((pokemon) => pokemon.species));
  return detected.reduce((total, archetype) => {
    const hasSetter = archetype.setters.some((name) => selected.has(name));
    const hasAbuser = archetype.abusers.some((name) => selected.has(name));
    if (hasSetter && hasAbuser) return total + (archetype.confidence === 'high' ? 0.12 : 0.08);
    if (hasSetter || hasAbuser) return total + 0.015;
    return total;
  }, 0);
}

export function describeArchetype(side: '내 팀' | '상대 팀', archetype: TeamArchetype): string {
  const confidence = archetype.confidence === 'high' ? '높은 확률' : '가능성';
  return `${side}: ${archetype.evidence.join(' + ')} 조합으로 ${archetype.name} ${confidence}`;
}
