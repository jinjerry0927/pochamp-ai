import { getMove, getSpecies, localizeName, neutralLevel50Stats, typeMultiplier } from './dex.js';
import { archetypeSelectionBonus, describeArchetype, detectTeamArchetypes } from './meta.js';
import { battleStateSchema, teamSchema, type ActionEvaluation, type PreviewInput, type PreviewRecommendation, type Recommendation, type StatBlock, type TeamPokemon, type TurnInput } from './types.js';

const STATE_VERSION = 'm-b@2026-07-16/heuristic-rollout-v1';

class SeededRandom {
  constructor(private state: number) {}
  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

function stageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

function estimateDamagePercent(attacker: TeamPokemon, defenderName: string, moveName: string, random = 0.925): number {
  const move = getMove(moveName);
  const attackerSpecies = getSpecies(attacker.species);
  const defenderStats = neutralLevel50Stats(defenderName);
  if (!move || !attackerSpecies || !defenderStats) return 0;
  if (move.category === 'Status') return 0;
  const attack = move.category === 'Physical' ? attacker.stats.attack : attacker.stats.specialAttack;
  const defense = move.category === 'Physical' ? defenderStats.defense : defenderStats.specialDefense;
  const stab = attackerSpecies.types.includes(move.type) ? 1.5 : 1;
  const effectiveness = typeMultiplier(move.type, defenderName);
  const raw = (((22 * Math.max(move.power, 1) * attack) / Math.max(defense, 1)) / 50 + 2) * stab * effectiveness * random;
  return clamp(raw / defenderStats.hp, 0, 2);
}

function genericOpponentDamage(defender: TeamPokemon, opponentName: string, random: number): number {
  const opponent = getSpecies(opponentName);
  if (!opponent) return 0.18;
  const attack = Math.max(opponent.baseStats.attack, opponent.baseStats.specialAttack) * 2 + 5;
  const defense = opponent.baseStats.attack >= opponent.baseStats.specialAttack ? defender.stats.defense : defender.stats.specialDefense;
  const multiplier = Math.max(...opponent.types.map((type) => typeMultiplier(type, defender.species)), 1);
  const raw = (((22 * 80 * attack) / Math.max(defense, 1)) / 50 + 2) * 1.5 * multiplier * random;
  return clamp(raw / defender.stats.hp, 0, 2);
}

function bestDamage(attacker: TeamPokemon, defenderName: string): { move: string; damage: number } {
  return attacker.moves
    .map((move) => ({ move, damage: estimateDamagePercent(attacker, defenderName, move) }))
    .sort((a, b) => b.damage - a.damage)[0] ?? { move: attacker.moves[0], damage: 0 };
}

function matchupScore(attacker: TeamPokemon, defenderName: string): number {
  const defender = getSpecies(defenderName);
  if (!defender) return -0.5;
  const dealt = bestDamage(attacker, defenderName).damage;
  const received = genericOpponentDamage(attacker, defenderName, 0.925);
  const speed = attacker.stats.speed > defender.baseStats.speed * 2 + 5 ? 0.08 : -0.04;
  return (dealt - received) + speed;
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, chosen: T[]) => {
    if (chosen.length === size) {
      result.push([...chosen]);
      return;
    }
    for (let index = start; index <= items.length - (size - chosen.length); index += 1) {
      const item = items[index];
      if (item !== undefined) walk(index + 1, [...chosen, item]);
    }
  };
  walk(0, []);
  return result;
}

function roleFor(pokemon: TeamPokemon): string {
  const offense = Math.max(pokemon.stats.attack, pokemon.stats.specialAttack);
  const bulk = pokemon.stats.hp + pokemon.stats.defense + pokemon.stats.specialDefense;
  if (pokemon.stats.speed >= offense * 0.9) return '선봉·스피드 압박';
  if (bulk >= offense * 2.4) return '교체·받이';
  return '마무리·화력';
}

function asOutcome(rate: number): ActionEvaluation['outcome'] {
  return {
    favorable: Math.round(rate * 100),
    neutral: Math.round((1 - Math.abs(rate - 0.5) * 2) * 20),
    unfavorable: Math.round((1 - rate) * 100),
  };
}

export function recommendPreview(input: PreviewInput): PreviewRecommendation {
  const started = performance.now();
  const team = teamSchema.parse(input.team);
  if (input.opponentSpecies.length < 3) throw new Error('상대 포켓몬을 최소 3마리 입력해야 합니다.');
  const ownArchetypes = detectTeamArchetypes(team.pokemon.map((pokemon) => pokemon.species));
  const opponentArchetypes = detectTeamArchetypes(input.opponentSpecies);
  const ownOptions = combinations(team.pokemon, 3).flatMap((members) => members.map((lead) => ({ members, lead })));
  const opponentOptions = combinations(input.opponentSpecies, 3).flatMap((members) => members.map((lead) => ({ members, lead })));
  const matchupCache = new Map<string, number>();
  const scoreMatchup = (pokemon: TeamPokemon, defender: string): number => {
    const key = `${pokemon.id}:${defender}`;
    const cached = matchupCache.get(key);
    if (cached !== undefined) return cached;
    const score = matchupScore(pokemon, defender);
    matchupCache.set(key, score);
    return score;
  };

  const ranked = ownOptions.map((option) => {
    let total = 0;
    for (const opponent of opponentOptions) {
      const leadScore = scoreMatchup(option.lead, opponent.lead);
      const rosterScore = option.members.reduce((sum, pokemon) => {
        const average = opponent.members.reduce((inner, defender) => inner + scoreMatchup(pokemon, defender), 0) / opponent.members.length;
        return sum + average;
      }, 0) / option.members.length;
      total += leadScore * 0.55 + rosterScore * 0.45;
    }
    const score = total / opponentOptions.length + archetypeSelectionBonus(option.members, ownArchetypes);
    const rate = sigmoid(score * 2.4);
    return { option, score, rate };
  }).sort((a, b) => b.score - a.score);

  const actions = ranked.slice(0, 3).map(({ option, score, rate }): ActionEvaluation => ({
    kind: 'switch',
    id: `${option.lead.id}:${option.members.map((member) => member.id).join(',')}`,
    label: `${option.lead.species} 선봉 · ${option.members.map((member) => member.species).join(' / ')}`,
    simulatedWinRate: Math.round(rate * 1000) / 10,
    score,
    outcome: asOutcome(rate),
    reasons: ['60개 출전·선봉 후보를 전수 비교', '상대의 가능한 출전 3마리와 선봉을 평균 평가'],
    risks: ['상대의 기술·도구가 공개되지 않아 합법 세트 평균을 가정'],
  }));
  actions.forEach((action, index) => {
    const option = ranked[index]?.option;
    if (option) {
      action.label = `${localizeName('species', option.lead.species)} 선봉 · ${option.members.map((member) => localizeName('species', member.species)).join(' / ')}`;
      const selectedArchetypes = detectTeamArchetypes(option.members.map((member) => member.species));
      action.reasons.unshift(...selectedArchetypes.map((archetype) => `${archetype.name} 코어를 함께 선출`));
      action.risks.unshift(...opponentArchetypes.map((archetype) => `${archetype.name} 전개를 막지 못하면 상성 평가가 악화될 수 있음`));
    }
  });
  const best = ranked[0];
  if (!best || !actions[0]) throw new Error('팀 추천 후보를 만들지 못했습니다.');

  const recommendation: PreviewRecommendation = {
    phase: 'preview',
    primaryAction: actions[0],
    alternatives: actions.slice(1),
    selectedPokemonIds: best.option.members.map((member) => member.id),
    leadPokemonId: best.option.lead.id,
    roles: Object.fromEntries(best.option.members.map((member) => [member.id, roleFor(member)])),
    simulatedWinRate: actions[0].simulatedWinRate,
    confidence: input.opponentSpecies.length === 6 || opponentArchetypes.some((archetype) => archetype.confidence === 'high') ? 'medium' : 'low',
    assumptions: ['상대 세부 세트가 없으므로 종·폼의 중립 Lv.50 스탯과 일반적인 자속 기술을 가정', 'Champions 고유 효과는 아직 검증 데이터가 있는 경우에만 반영'],
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
    stateVersion: STATE_VERSION,
  };
  recommendation.assumptions.unshift(
    ...ownArchetypes.map((archetype) => describeArchetype('내 팀', archetype)),
    ...opponentArchetypes.map((archetype) => describeArchetype('상대 팀', archetype)),
    '메타 조합은 공개 랭크 데이터와 알려진 날씨·트릭룸 시너지를 사전분포로만 사용합니다.',
  );
  return recommendation;
}

function evaluateMove(
  attacker: TeamPokemon,
  defenderName: string,
  moveName: string,
  rolloutCount: number,
  ownHpRatio: number,
  opponentHpRatio: number,
): ActionEvaluation {
  const move = getMove(moveName);
  if (!move) throw new Error(`기술을 찾을 수 없습니다: ${moveName}`);
  const rng = new SeededRandom(0x50c0_2026 ^ move.id.length);
  let favorable = 0;
  let scoreTotal = 0;
  for (let rollout = 0; rollout < rolloutCount; rollout += 1) {
    let ownHp = ownHpRatio;
    let opponentHp = opponentHpRatio;
    for (let turn = 0; turn < 3; turn += 1) {
      const selected = turn === 0 ? moveName : bestDamage(attacker, defenderName).move;
      const selectedMove = getMove(selected);
      const hit = selectedMove ? rng.next() * 100 <= selectedMove.accuracy : false;
      const dealt = hit ? estimateDamagePercent(attacker, defenderName, selected, 0.85 + rng.next() * 0.15) : 0;
      const received = genericOpponentDamage(attacker, defenderName, 0.85 + rng.next() * 0.15);
      const defender = getSpecies(defenderName);
      const goFirst = (selectedMove?.priority ?? 0) > 0 || attacker.stats.speed >= (defender?.baseStats.speed ?? 50) * 2 + 5;
      if (goFirst) {
        opponentHp -= dealt;
        if (opponentHp > 0) ownHp -= received;
      } else {
        ownHp -= received;
        if (ownHp > 0) opponentHp -= dealt;
      }
      if (ownHp <= 0 || opponentHp <= 0) break;
    }
    const score = clamp(0.5 + (ownHp - opponentHp) * 0.35);
    scoreTotal += score;
    if (score >= 0.55) favorable += 1;
  }
  const rate = scoreTotal / rolloutCount;
  const effectiveness = typeMultiplier(move.type, defenderName);
  return {
    kind: 'move',
    id: move.id,
    label: localizeName('move', move.name),
    simulatedWinRate: Math.round(rate * 1000) / 10,
    score: rate,
    outcome: asOutcome(rate),
    reasons: [effectiveness > 1 ? `상성 배율 ${effectiveness}배` : '3턴 공통 시드 롤아웃 비교', `${favorable}/${rolloutCount}회 유리한 전개`],
    risks: move.category === 'Status' ? ['상태 기술의 개별 효과는 일반 효용값으로 평가'] : [],
  };
}

function evaluateSwitch(target: TeamPokemon, opponentName: string, rolloutCount: number, hpRatio: number): ActionEvaluation {
  const rng = new SeededRandom(0x51_17_2026 ^ target.id.length);
  let scoreTotal = 0;
  for (let rollout = 0; rollout < rolloutCount; rollout += 1) {
    const entryDamage = genericOpponentDamage(target, opponentName, 0.85 + rng.next() * 0.15);
    const pressure = bestDamage(target, opponentName).damage;
    scoreTotal += clamp(0.5 + (pressure - entryDamage) * 0.4 + (hpRatio - 1) * 0.35);
  }
  const rate = scoreTotal / rolloutCount;
  return {
    kind: 'switch',
    id: target.id,
    label: `${target.species}로 교체`,
    simulatedWinRate: Math.round(rate * 1000) / 10,
    score: rate,
    outcome: asOutcome(rate),
    reasons: ['교체 직후 예상 피격과 다음 턴 압박을 함께 평가'],
    risks: ['교체를 읽은 상대 행동은 일반적인 공격 분포로 가정'],
  };
}

export function recommendTurn(input: TurnInput): Recommendation {
  const started = performance.now();
  const team = teamSchema.parse(input.team);
  const state = battleStateSchema.parse(input.state);
  if (!state.ownActive || !state.opponentActive) throw new Error('양쪽 활성 포켓몬 상태가 필요합니다.');
  const active = team.pokemon.find((pokemon) => pokemon.id === state.ownActive?.teamPokemonId)
    ?? team.pokemon.find((pokemon) => pokemon.species === state.ownActive?.species);
  if (!active) throw new Error('내 활성 포켓몬을 등록 팀에서 찾지 못했습니다.');
  const rolloutCount = Math.min(512, Math.max(32, input.rolloutCount ?? 256));
  const canUseMoves = state.phase !== 'forced-switch' && !state.ownActive.fainted && state.ownActive.currentHp > 0;
  const ownHpRatio = clamp(state.ownActive.currentHp / state.ownActive.maxHp);
  const opponentHpRatio = clamp(state.opponentActive.currentHp / state.opponentActive.maxHp);
  const moveActions = canUseMoves
    ? active.moves
      .filter((move) => state.ownActive?.remainingPp[move] !== 0)
      .map((move) => evaluateMove(active, state.opponentActive!.species, move, rolloutCount, ownHpRatio, opponentHpRatio))
    : [];
  const switchActions = state.ownBench
    .filter((bench) => !bench.fainted)
    .map((bench) => team.pokemon.find((pokemon) => pokemon.id === bench.teamPokemonId || pokemon.species === bench.species))
    .filter((pokemon): pokemon is TeamPokemon => Boolean(pokemon))
    .map((pokemon) => {
      const bench = state.ownBench.find((candidate) => candidate.teamPokemonId === pokemon.id || candidate.species === pokemon.species);
      const evaluation = evaluateSwitch(pokemon, state.opponentActive!.species, rolloutCount, bench ? clamp(bench.currentHp / bench.maxHp) : 1);
      evaluation.label = `${localizeName('species', pokemon.species)}로 교체`;
      return evaluation;
    });
  const ranked = [...moveActions, ...switchActions].sort((a, b) => b.score - a.score);
  const primary = ranked[0];
  if (!primary) throw new Error('합법 행동 후보가 없습니다.');
  const unsupported = !getSpecies(state.opponentActive.species);
  return {
    phase: state.phase === 'forced-switch' ? 'forced-switch' : 'turn',
    primaryAction: primary,
    alternatives: ranked.slice(1, 3),
    simulatedWinRate: primary.simulatedWinRate,
    confidence: unsupported ? 'low' : state.opponentActive.revealedMoves.length >= 2 ? 'high' : 'medium',
    assumptions: ['행동당 최대 512회, 3턴 근사 롤아웃', '상대 미공개 기술·도구·특성은 일반적인 자속 공격 분포로 대체'],
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
    stateVersion: STATE_VERSION,
  };
}

export const internalMath = { estimateDamagePercent, matchupScore, stageMultiplier };
