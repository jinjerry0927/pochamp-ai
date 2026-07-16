import { performance } from 'node:perf_hooks';
import {
  recommendTurn,
  regulationSpecies,
} from '../packages/engine/dist/index.js';

const pokemon = (id, species, ability, heldItem, moves, stats) => ({
  id,
  species,
  form: '',
  gender: 'N',
  ability,
  heldItem,
  moves,
  level: 50,
  stats,
  statAlignment: 'Serious',
  megaEligible: false,
});

const team = {
  id: 'benchmark-team',
  name: 'M4 벤치마크 팀',
  regulationId: 'M-B@2026-07-16',
  updatedAt: '2026-07-16T00:00:00.000Z',
  pokemon: [
    pokemon('garchomp', 'Garchomp', 'Rough Skin', 'Life Orb', ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Swords Dance'], { hp: 183, attack: 182, defense: 115, specialAttack: 90, specialDefense: 105, speed: 169 }),
    pokemon('rotom', 'Rotom-Wash', 'Levitate', 'Leftovers', ['Hydro Pump', 'Volt Switch', 'Will-O-Wisp', 'Protect'], { hp: 157, attack: 70, defense: 127, specialAttack: 138, specialDefense: 127, speed: 106 }),
    pokemon('gengar', 'Gengar', 'Cursed Body', 'Focus Sash', ['Shadow Ball', 'Sludge Bomb', 'Thunderbolt', 'Destiny Bond'], { hp: 135, attack: 70, defense: 81, specialAttack: 182, specialDefense: 95, speed: 178 }),
    pokemon('dragonite', 'Dragonite', 'Multiscale', 'Lum Berry', ['Dragon Claw', 'Extreme Speed', 'Fire Punch', 'Dragon Dance'], { hp: 198, attack: 204, defense: 115, specialAttack: 108, specialDefense: 120, speed: 132 }),
    pokemon('scizor', 'Scizor', 'Technician', 'Metal Coat', ['Bullet Punch', 'U-turn', 'Close Combat', 'Knock Off'], { hp: 177, attack: 200, defense: 120, specialAttack: 67, specialDefense: 100, speed: 85 }),
    pokemon('milotic', 'Milotic', 'Competitive', 'Sitrus Berry', ['Scald', 'Ice Beam', 'Recover', 'Haze'], { hp: 202, attack: 65, defense: 144, specialAttack: 120, specialDefense: 145, speed: 101 }),
  ],
};

const baseState = {
  status: 'none',
  fainted: false,
  boosts: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
  revealedMoves: [],
};

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

const species = regulationSpecies();
const unsupported = species.filter((entry) => !entry.supported);
const durations = [];
let switchRecommendations = 0;
let averageEstimate = 0;

for (let index = 0; index < 1000; index += 1) {
  const activeIndex = index % 3;
  const selected = team.pokemon.slice(0, 3);
  const active = selected[activeIndex];
  const bench = selected.filter((candidate) => candidate.id !== active.id);
  const opponent = species[index % species.length];
  const state = {
    phase: 'turn',
    turn: (index % 20) + 1,
    selectedOwnIds: selected.map((candidate) => candidate.id),
    opponentPreview: [opponent.name],
    ownActive: { ...baseState, teamPokemonId: active.id, species: active.species, currentHp: active.stats.hp, maxHp: active.stats.hp },
    opponentActive: { ...baseState, species: opponent.name, currentHp: 100, maxHp: 100 },
    ownBench: bench.map((candidate) => ({ ...baseState, teamPokemonId: candidate.id, species: candidate.species, currentHp: candidate.stats.hp, maxHp: candidate.stats.hp })),
    opponentBench: [],
    weather: 'none',
    terrain: 'none',
    ownHazards: [],
    opponentHazards: [],
    ownMegaUsed: false,
    opponentMegaUsed: false,
  };

  const started = performance.now();
  const recommendation = recommendTurn({ team, state, rolloutCount: 64 });
  durations.push(performance.now() - started);
  averageEstimate += recommendation.simulatedWinRate;
  if (recommendation.primaryAction.kind === 'switch') switchRecommendations += 1;
}

const result = {
  qualification: 'engine-throughput-only',
  note: '실제 승률 우위는 골든 프레임 및 무도움/도움 친선 30판 실험 후 별도로 판정합니다.',
  regulationForms: species.length,
  unsupportedForms: unsupported.map((entry) => entry.name),
  decisions: durations.length,
  rolloutCountPerAction: 64,
  latencyMs: {
    p50: Number(percentile(durations, 0.5).toFixed(2)),
    p95: Number(percentile(durations, 0.95).toFixed(2)),
    max: Number(Math.max(...durations).toFixed(2)),
  },
  switchRecommendations,
  meanSimulationEstimate: Number((averageEstimate / durations.length).toFixed(4)),
};

console.log(JSON.stringify(result, null, 2));

if (species.length < 200 || unsupported.length > 0) process.exitCode = 1;
if (result.latencyMs.p95 >= 2000) process.exitCode = 1;
