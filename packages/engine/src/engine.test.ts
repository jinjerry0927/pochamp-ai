import { describe, expect, it } from 'vitest';
import { getItemExists, getSpecies, getSpeciesBuilderOptions, recommendPreview, recommendTurn, regulationItems, regulationSpecies, statAlignmentOptions, validateTeam } from './index.js';
import type { BattleState, Team } from './types.js';

const pokemon = (id: string, species: string, ability: string, item: string, moves: [string, string, string, string], stats: Team['pokemon'][number]['stats']): Team['pokemon'][number] => ({
  id, species, form: '', gender: 'N', ability, heldItem: item, moves, level: 50, stats, statAlignment: 'Serious', megaEligible: false,
});

const team: Team = {
  id: 'team-1',
  name: '테스트 팀',
  regulationId: 'M-B@2026-07-16',
  updatedAt: new Date('2026-07-16T00:00:00Z').toISOString(),
  pokemon: [
    pokemon('garchomp', 'Garchomp', 'Rough Skin', 'Life Orb', ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'], { hp: 183, attack: 182, defense: 115, specialAttack: 90, specialDefense: 105, speed: 169 }),
    pokemon('rotom', 'Rotom-Wash', 'Levitate', 'Leftovers', ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Protect'], { hp: 157, attack: 70, defense: 127, specialAttack: 138, specialDefense: 127, speed: 106 }),
    pokemon('gengar', 'Gengar', 'Cursed Body', 'Focus Sash', ['Shadow Ball', 'Sludge Bomb', 'Thunderbolt', 'Destiny Bond'], { hp: 135, attack: 70, defense: 81, specialAttack: 182, specialDefense: 95, speed: 178 }),
    pokemon('dragonite', 'Dragonite', 'Multiscale', 'Lum Berry', ['Dragon Claw', 'Extreme Speed', 'Fire Punch', 'Dragon Dance'], { hp: 198, attack: 204, defense: 115, specialAttack: 108, specialDefense: 120, speed: 132 }),
    pokemon('scizor', 'Scizor', 'Technician', 'Metal Coat', ['Bullet Punch', 'U-turn', 'Close Combat', 'Knock Off'], { hp: 177, attack: 200, defense: 120, specialAttack: 67, specialDefense: 100, speed: 85 }),
    pokemon('milotic', 'Milotic', 'Competitive', 'Sitrus Berry', ['Scald', 'Ice Beam', 'Recover', 'Haze'], { hp: 202, attack: 65, defense: 144, specialAttack: 120, specialDefense: 145, speed: 101 }),
  ],
};

describe('M-B 데이터', () => {
  it('200개 이상의 폼을 제공하고 Garchomp를 해석한다', () => {
    expect(regulationSpecies().length).toBeGreaterThan(200);
    expect(getSpecies('Garchomp')?.types).toContain('Dragon');
  });

  it('팀 편집기에 전체 도구와 종별 특성·기술·성격 후보를 제공한다', () => {
    const options = getSpeciesBuilderOptions('Garchomp');
    expect(regulationItems()).toHaveLength(148);
    expect(options.abilities).toContain('Rough Skin');
    expect(options.moves).toContain('Earthquake');
    expect(statAlignmentOptions).toHaveLength(21);
    expect(getItemExists('Barbaracleite')).toBe(true);
    expect(getItemExists('Choice Band')).toBe(false);
  });
});

describe('팀 검증', () => {
  it('정상적인 6마리 팀을 검증한다', () => {
    const result = validateTeam(team);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('중복 도구를 거부한다', () => {
    const duplicate = structuredClone(team);
    duplicate.pokemon[1]!.heldItem = 'Life Orb';
    expect(validateTeam(duplicate).errors.some((message) => message.includes('중복'))).toBe(true);
  });

  it('중복 기술과 잘못된 Stat Alignment를 거부한다', () => {
    const duplicate = structuredClone(team);
    duplicate.pokemon[0]!.moves = ['Earthquake', 'Earthquake', 'Stone Edge', 'Swords Dance'];
    duplicate.pokemon[0]!.statAlignment = 'neutral';
    const errors = validateTeam(duplicate).errors;
    expect(errors.some((message) => message.includes('같은 기술'))).toBe(true);
    expect(errors.some((message) => message.includes('Stat Alignment'))).toBe(true);
  });
});

describe('추천', () => {
  it('60개 출전·선봉 후보에서 3마리를 고른다', () => {
    const result = recommendPreview({ team, opponentSpecies: ['Charizard', 'Blastoise', 'Venusaur', 'Gengar', 'Dragonite', 'Tyranitar'] });
    expect(result.selectedPokemonIds).toHaveLength(3);
    expect(result.alternatives).toHaveLength(2);
    expect(result.latencyMs).toBeLessThan(2000);
  });

  it('기술과 교체를 함께 평가한다', () => {
    const baseState = { status: 'none' as const, fainted: false, boosts: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 }, revealedMoves: [] };
    const state: BattleState = {
      phase: 'turn', turn: 1, selectedOwnIds: ['garchomp', 'rotom', 'gengar'], opponentPreview: ['Charizard', 'Blastoise', 'Venusaur'],
      ownActive: { ...baseState, teamPokemonId: 'garchomp', species: 'Garchomp', currentHp: 183, maxHp: 183 },
      opponentActive: { ...baseState, species: 'Charizard', currentHp: 100, maxHp: 100 },
      ownBench: [
        { ...baseState, teamPokemonId: 'rotom', species: 'Rotom-Wash', currentHp: 157, maxHp: 157 },
        { ...baseState, teamPokemonId: 'gengar', species: 'Gengar', currentHp: 135, maxHp: 135 },
      ],
      opponentBench: [], weather: 'none', terrain: 'none', ownHazards: [], opponentHazards: [], ownMegaUsed: false, opponentMegaUsed: false,
    };
    const result = recommendTurn({ team, state, rolloutCount: 64 });
    expect(result.primaryAction.label.length).toBeGreaterThan(0);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('강제 교체와 PP 0 상태에서는 기술 후보를 제외한다', () => {
    const baseState = { status: 'none' as const, fainted: false, boosts: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 }, revealedMoves: [] };
    const state: BattleState = {
      phase: 'forced-switch', turn: 3, selectedOwnIds: ['garchomp', 'rotom', 'gengar'], opponentPreview: ['Charizard', 'Blastoise', 'Venusaur'],
      ownActive: { ...baseState, teamPokemonId: 'garchomp', species: 'Garchomp', currentHp: 0, maxHp: 183, fainted: true, remainingPp: { Earthquake: 0, 'Dragon Claw': 0, 'Stone Edge': 0, 'Swords Dance': 0 } },
      opponentActive: { ...baseState, species: 'Charizard', currentHp: 70, maxHp: 100 },
      ownBench: [
        { ...baseState, teamPokemonId: 'rotom', species: 'Rotom-Wash', currentHp: 157, maxHp: 157 },
        { ...baseState, teamPokemonId: 'gengar', species: 'Gengar', currentHp: 135, maxHp: 135 },
      ],
      opponentBench: [], weather: 'none', terrain: 'none', ownHazards: [], opponentHazards: [], ownMegaUsed: false, opponentMegaUsed: false,
    };
    const result = recommendTurn({ team, state, rolloutCount: 32 });
    expect(result.primaryAction.kind).toBe('switch');
    expect(result.alternatives.every((action) => action.kind === 'switch')).toBe(true);
  });
});
