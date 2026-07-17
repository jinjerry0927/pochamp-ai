import { getMove, getSpecies, localizeName, neutralLevel50Stats, typeMultiplier } from './dex.js';
import { archetypeLeadBonus, archetypeSelectionBonus, describeArchetype, detectTeamArchetypes } from './meta.js';
import { battleStateSchema, teamSchema, type ActionEvaluation, type BattleState, type PreviewInput, type PreviewRecommendation, type Recommendation, type StatBlock, type TeamPokemon, type TurnInput } from './types.js';

const STATE_VERSION = 'm-b@2026-07-17/battle-policy-v2';
const PIVOT_MOVE_IDS = new Set(['uturn', 'voltswitch', 'flipturn', 'partingshot', 'chillyreception', 'teleport']);

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

function weatherMultiplier(moveType: string, weather: BattleState['weather'] = 'none'): number {
  if (weather === 'rain') return moveType === 'Water' ? 1.5 : moveType === 'Fire' ? 0.5 : 1;
  if (weather === 'sun') return moveType === 'Fire' ? 1.5 : moveType === 'Water' ? 0.5 : 1;
  return 1;
}

function estimateDamagePercent(attacker: TeamPokemon, defenderName: string, moveName: string, random = 0.925, weather: BattleState['weather'] = 'none'): number {
  const move = getMove(moveName);
  const attackerSpecies = getSpecies(attacker.species);
  const defenderStats = neutralLevel50Stats(defenderName);
  if (!move || !attackerSpecies || !defenderStats) return 0;
  if (move.category === 'Status') return 0;
  const attack = move.category === 'Physical' ? attacker.stats.attack : attacker.stats.specialAttack;
  const defense = move.category === 'Physical' ? defenderStats.defense : defenderStats.specialDefense;
  const stab = attackerSpecies.types.includes(move.type) ? 1.5 : 1;
  const effectiveness = typeMultiplier(move.type, defenderName);
  const raw = (((22 * Math.max(move.power, 1) * attack) / Math.max(defense, 1)) / 50 + 2) * stab * effectiveness * weatherMultiplier(move.type, weather) * random;
  return clamp(raw / defenderStats.hp, 0, 2);
}

function genericOpponentDamage(defender: TeamPokemon, opponentName: string, random: number): number {
  const opponent = getSpecies(opponentName);
  if (!opponent) return 0.18;
  const attack = Math.max(opponent.baseStats.attack, opponent.baseStats.specialAttack) * 2 + 5;
  const defense = opponent.baseStats.attack >= opponent.baseStats.specialAttack ? defender.stats.defense : defender.stats.specialDefense;
  const stabMultipliers = opponent.types.map((type) => typeMultiplier(type, defender.species));
  const multiplier = stabMultipliers.length ? Math.max(...stabMultipliers) : 1;
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
    const score = total / opponentOptions.length
      + archetypeSelectionBonus(option.members, ownArchetypes)
      + archetypeLeadBonus(option.lead, option.members, ownArchetypes);
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
      action.reasons.unshift(...selectedArchetypes
        .filter((archetype) => archetype.setters.includes(option.lead.species))
        .map((archetype) => `${localizeName('species', option.lead.species)} 선봉으로 ${archetype.name} 전개 시작`));
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

function statusMoveUtility(moveId: string, state: BattleState, ownHpRatio: number, active: TeamPokemon): number {
  const opponent = state.opponentActive;
  if (!opponent) return 0;
  if (moveId === 'yawn') return opponent.status === 'none' && !opponent.volatileStatuses?.includes('drowsy') ? 0.22 : -0.08;
  if (moveId === 'trickroom') {
    if (state.trickRoomTurns > 0) return -0.12;
    const defender = getSpecies(opponent.species);
    return active.stats.speed < (defender?.baseStats.speed ?? 50) * 2 + 5 ? 0.2 : -0.03;
  }
  if (['recover', 'roost', 'slackoff', 'softboiled', 'synthesis', 'moonlight', 'morningsun'].includes(moveId)) {
    return ownHpRatio < 0.55 ? 0.25 : ownHpRatio < 0.8 ? 0.1 : -0.12;
  }
  if (['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker'].includes(moveId)) return 0.07;
  if (['swordsdance', 'nastyplot', 'dragondance', 'calmmind', 'bulkup', 'quiverdance', 'shellsmash'].includes(moveId)) return 0.13;
  if (['willowisp', 'thunderwave', 'toxic', 'spore', 'sleeppowder', 'stunspore'].includes(moveId)) {
    return opponent.status === 'none' ? 0.16 : -0.08;
  }
  return 0.04;
}

function evaluateMove(
  attacker: TeamPokemon,
  defenderName: string,
  moveName: string,
  rolloutCount: number,
  ownHpRatio: number,
  opponentHpRatio: number,
  state: BattleState,
  pivotTarget?: { pokemon: TeamPokemon; state: BattleState['ownBench'][number] },
): ActionEvaluation {
  const move = getMove(moveName);
  if (!move) throw new Error(`기술을 찾을 수 없습니다: ${moveName}`);
  const rng = new SeededRandom(0x50c0_2026 ^ move.id.length);
  let favorable = 0;
  let scoreTotal = 0;
  const ownStatus = state.ownActive?.status ?? 'none';
  const opponentStatus = state.opponentActive?.status ?? 'none';
  const cannotNormallyAct = (ownStatus === 'sleep' && move.id !== 'sleeptalk') || ownStatus === 'freeze';
  const stayingWhileDrowsy = state.ownActive?.volatileStatuses?.includes('drowsy') ?? false;
  const utility = move.category === 'Status' ? statusMoveUtility(move.id, state, ownHpRatio, attacker) : 0;
  const isPivot = PIVOT_MOVE_IDS.has(move.id) && Boolean(pivotTarget);
  const pivotUtility = isPivot && pivotTarget
    ? clamp((matchupScore(pivotTarget.pokemon, defenderName) - matchupScore(attacker, defenderName)) * 0.08, -0.02, 0.08) + 0.035
    : 0;
  for (let rollout = 0; rollout < rolloutCount; rollout += 1) {
    let ownHp = ownHpRatio;
    let opponentHp = opponentHpRatio;
    let currentAttacker = attacker;
    for (let turn = 0; turn < 3; turn += 1) {
      const selected = turn === 0 ? moveName : bestDamage(currentAttacker, defenderName).move;
      const selectedMove = getMove(selected);
      const blocked = turn === 0 && cannotNormallyAct;
      const hit = !blocked && selectedMove ? rng.next() * 100 <= selectedMove.accuracy : false;
      const burnMultiplier = ownStatus === 'burn' && selectedMove?.category === 'Physical' ? 0.5 : 1;
      const dealt = hit ? estimateDamagePercent(currentAttacker, defenderName, selected, 0.85 + rng.next() * 0.15, state.weather) * burnMultiplier : 0;
      const opponentActionMultiplier = opponentStatus === 'sleep' || opponentStatus === 'freeze' ? 0.25 : 1;
      const received = genericOpponentDamage(currentAttacker, defenderName, 0.85 + rng.next() * 0.15) * opponentActionMultiplier;
      const defender = getSpecies(defenderName);
      const ownSpeed = currentAttacker.stats.speed * (ownStatus === 'paralysis' ? 0.5 : 1);
      const opponentSpeed = ((defender?.baseStats.speed ?? 50) * 2 + 5) * (opponentStatus === 'paralysis' ? 0.5 : 1);
      const priority = selectedMove?.priority ?? 0;
      const goFirst = priority !== 0 ? priority > 0 : state.trickRoomTurns > 0 ? ownSpeed <= opponentSpeed : ownSpeed >= opponentSpeed;
      if (goFirst) {
        opponentHp -= dealt;
        if (isPivot && turn === 0 && hit && opponentHp > 0 && pivotTarget) {
          currentAttacker = pivotTarget.pokemon;
          ownHp = clamp(pivotTarget.state.currentHp / pivotTarget.state.maxHp)
            - genericOpponentDamage(currentAttacker, defenderName, 0.85 + rng.next() * 0.15) * opponentActionMultiplier;
        } else if (opponentHp > 0) ownHp -= received;
      } else {
        ownHp -= received;
        if (ownHp > 0) {
          opponentHp -= dealt;
          if (isPivot && turn === 0 && hit && pivotTarget) {
            currentAttacker = pivotTarget.pokemon;
            ownHp = clamp(pivotTarget.state.currentHp / pivotTarget.state.maxHp);
          }
        }
      }
      if (ownHp <= 0 || opponentHp <= 0) break;
    }
    const score = clamp(0.5 + (ownHp - opponentHp) * 0.35 + utility + pivotUtility - (stayingWhileDrowsy ? 0.16 : 0));
    scoreTotal += score;
    if (score >= 0.55) favorable += 1;
  }
  const rate = scoreTotal / rolloutCount;
  const effectiveness = typeMultiplier(move.type, defenderName);
  return {
    kind: 'move',
    id: move.id,
    label: isPivot && pivotTarget
      ? `${localizeName('move', move.name)} → ${localizeName('species', pivotTarget.pokemon.species)} 교체`
      : localizeName('move', move.name),
    simulatedWinRate: Math.round(rate * 1000) / 10,
    score: rate,
    outcome: asOutcome(rate),
    reasons: [
      ...(isPivot && pivotTarget ? [`공격 후 ${localizeName('species', pivotTarget.pokemon.species)}로 이어 주도권 유지`] : []),
      cannotNormallyAct ? `${ownStatus === 'sleep' ? '수면' : '얼음'} 상태의 행동 실패 위험 반영` : effectiveness > 1 ? `상성 배율 ${effectiveness}배` : '3턴 공통 시드 롤아웃 비교',
      state.trickRoomTurns > 0 ? `트릭룸 ${state.trickRoomTurns}턴 남음 · 느린 쪽 선공 반영` : `${favorable}/${rolloutCount}회 유리한 전개`,
    ],
    risks: move.category === 'Status' ? ['상태 기술은 확인된 주요 효과와 일반 효용값을 함께 평가'] : [],
    pivotTargetPokemonId: isPivot ? pivotTarget?.pokemon.id : undefined,
  };
}

function evaluateSwitch(target: TeamPokemon, opponentName: string, rolloutCount: number, hpRatio: number, urgentExit: boolean, forced: boolean): ActionEvaluation {
  const rng = new SeededRandom(0x51_17_2026 ^ target.id.length);
  let scoreTotal = 0;
  for (let rollout = 0; rollout < rolloutCount; rollout += 1) {
    const entryDamage = genericOpponentDamage(target, opponentName, 0.85 + rng.next() * 0.15);
    const pressure = bestDamage(target, opponentName).damage;
    const tempoPenalty = forced ? 0 : urgentExit ? 0.02 : 0.14;
    scoreTotal += clamp(0.5 + (pressure - entryDamage) * 0.4 + (hpRatio - 1) * 0.35 + (urgentExit ? 0.2 : 0) - tempoPenalty);
  }
  const rate = scoreTotal / rolloutCount;
  return {
    kind: 'switch',
    id: target.id,
    label: `${target.species}로 교체`,
    simulatedWinRate: Math.round(rate * 1000) / 10,
    score: rate,
    outcome: asOutcome(rate),
    reasons: [urgentExit ? '수면·얼음·하품 대기 상태를 해제하는 교체 가치 반영' : '교체 직후 예상 피격과 다음 턴 압박을 함께 평가'],
    risks: [forced ? '교체 후 상대와의 상성을 우선 평가' : '공격 기회를 포기하고 상대에게 한 턴을 내주는 비용 반영'],
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
  const livingBench = state.ownBench
    .filter((bench) => !bench.fainted && bench.currentHp > 0)
    .map((bench) => ({
      state: bench,
      pokemon: team.pokemon.find((pokemon) => pokemon.id === bench.teamPokemonId || pokemon.species === bench.species),
    }))
    .filter((entry): entry is { state: BattleState['ownBench'][number]; pokemon: TeamPokemon } => Boolean(entry.pokemon));
  const pivotTarget = [...livingBench].sort((left, right) => {
    const leftScore = matchupScore(left.pokemon, state.opponentActive!.species) + clamp(left.state.currentHp / left.state.maxHp) * 0.2;
    const rightScore = matchupScore(right.pokemon, state.opponentActive!.species) + clamp(right.state.currentHp / right.state.maxHp) * 0.2;
    return rightScore - leftScore;
  })[0];
  const moveActions = canUseMoves
    ? active.moves
      .filter((move) => state.ownActive?.remainingPp[move] !== 0)
      .map((move) => evaluateMove(active, state.opponentActive!.species, move, rolloutCount, ownHpRatio, opponentHpRatio, state, pivotTarget))
    : [];
  const switchActions = livingBench.map(({ pokemon, state: bench }) => {
      const urgentExit = ['sleep', 'freeze'].includes(state.ownActive!.status) || Boolean(state.ownActive!.volatileStatuses?.includes('drowsy'));
      const evaluation = evaluateSwitch(pokemon, state.opponentActive!.species, rolloutCount, clamp(bench.currentHp / bench.maxHp), urgentExit, state.phase === 'forced-switch');
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
    confidence: unsupported ? 'low' : state.opponentPreview.length >= 6 ? 'high' : 'medium',
    assumptions: [
      '행동당 최대 512회, 3턴 근사 롤아웃',
      '상대의 아직 확인되지 않은 기술·도구·특성은 일반적인 자속 공격 분포로 대체',
      ...(state.trickRoomTurns > 0 ? [`트릭룸 잔여 ${state.trickRoomTurns}턴을 선공 순서에 반영`] : []),
      ...(state.ownActive.volatileStatuses?.includes('drowsy') ? ['내 포켓몬은 하품으로 다음 턴 수면 예정'] : []),
    ],
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
    stateVersion: STATE_VERSION,
  };
}

export const internalMath = { estimateDamagePercent, matchupScore, stageMultiplier };
