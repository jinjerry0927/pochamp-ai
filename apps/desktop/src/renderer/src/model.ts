import type { BattlePokemonState, Team, TeamPokemon } from '@pochamp/engine';

const stats = { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 };

export function emptyPokemon(index: number): TeamPokemon {
  return {
    id: `slot-${index + 1}`,
    species: '',
    form: '',
    gender: 'N',
    ability: '',
    heldItem: '',
    moves: ['', '', '', ''],
    level: 50,
    stats: { ...stats },
    statPoints: { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 },
    statAlignment: 'Serious',
    megaEligible: false,
  };
}

export function emptyTeam(): Team {
  return {
    id: crypto.randomUUID(),
    name: '새 팀',
    regulationId: 'M-B@2026-07-16',
    pokemon: Array.from({ length: 6 }, (_, index) => emptyPokemon(index)),
    updatedAt: new Date().toISOString(),
  };
}

export function battlePokemonState(pokemon: TeamPokemon, hpPercent = 100): BattlePokemonState {
  return {
    teamPokemonId: pokemon.id,
    species: pokemon.species,
    currentHp: Math.round(pokemon.stats.hp * hpPercent / 100),
    maxHp: pokemon.stats.hp,
    status: 'none',
    fainted: hpPercent <= 0,
    boosts: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    remainingPp: {},
    revealedMoves: [],
  };
}
