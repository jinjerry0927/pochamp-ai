import { calculateLevel50Stats, canLearnMove, getItemExists, getMove, getSpecies, isAbilityAvailable, regulationSpecies, statAlignmentOptions, toID } from './dex.js';
import { teamSchema, type Team, type ValidationResult } from './types.js';

export function validateTeam(input: unknown): ValidationResult {
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      warnings: [],
    };
  }

  const team: Team = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const legal = new Set(regulationSpecies().map((entry) => entry.id));
  const nationalDex = new Set<number>();
  const itemIds = new Set<string>();
  const alignments = new Set(statAlignmentOptions.map((alignment) => alignment.id));

  for (const pokemon of team.pokemon) {
    const species = getSpecies(pokemon.species);
    if (!species) {
      errors.push(`${pokemon.species}: 시뮬레이터에서 종/폼을 찾을 수 없습니다.`);
      continue;
    }
    if (!legal.has(species.id)) errors.push(`${species.name}: M-B 규정 목록에 없습니다.`);
    if (nationalDex.has(species.nationalDex)) errors.push(`${species.name}: 같은 전국도감 번호를 중복 사용할 수 없습니다.`);
    nationalDex.add(species.nationalDex);

    if (!isAbilityAvailable(pokemon)) errors.push(`${species.name}: 특성 ${pokemon.ability}을 사용할 수 없습니다.`);
    if (!alignments.has(pokemon.statAlignment)) errors.push(`${species.name}: Stat Alignment ${pokemon.statAlignment}을 사용할 수 없습니다.`);
    const statPointTotal = Object.values(pokemon.statPoints).reduce((sum, value) => sum + value, 0);
    if (statPointTotal < 66) warnings.push(`${species.name}: 능력 포인트를 ${statPointTotal}/66만 사용했습니다.`);
    const calculatedStats = calculateLevel50Stats(species.name, pokemon.statPoints, pokemon.statAlignment);
    if (calculatedStats && Object.keys(calculatedStats).some((stat) => calculatedStats[stat as keyof typeof calculatedStats] !== pokemon.stats[stat as keyof typeof pokemon.stats])) {
      warnings.push(`${species.name}: 입력된 실제 스탯이 능력 포인트 자동 계산값과 다릅니다. 실제 게임 수치를 최종값으로 사용합니다.`);
    }
    if (pokemon.heldItem) {
      if (!getItemExists(pokemon.heldItem)) errors.push(`${species.name}: 도구 ${pokemon.heldItem}을 찾을 수 없습니다.`);
      const itemId = toID(pokemon.heldItem);
      if (itemIds.has(itemId)) errors.push(`${pokemon.heldItem}: 같은 도구를 중복 사용할 수 없습니다.`);
      itemIds.add(itemId);
    }

    const moveIds = new Set<string>();
    for (const moveName of pokemon.moves) {
      const moveId = toID(moveName);
      if (moveIds.has(moveId)) errors.push(`${species.name}: 같은 기술 ${moveName}을 중복 선택할 수 없습니다.`);
      moveIds.add(moveId);
      if (!getMove(moveName)) {
        errors.push(`${species.name}: 기술 ${moveName}을 찾을 수 없습니다.`);
        continue;
      }
      const learnable = canLearnMove(species.name, moveName);
      if (learnable === false) errors.push(`${species.name}: ${moveName}을 배울 수 없습니다.`);
      if (learnable === null) warnings.push(`${species.name}: ${moveName}의 학습 가능 여부를 자동 확인하지 못했습니다.`);
    }

    if (pokemon.level !== 50) warnings.push(`${species.name}: 입력 레벨 ${pokemon.level} 대신 실제 전투 스탯을 Lv.50 기준값으로 사용합니다.`);
  }

  return { valid: errors.length === 0, errors, warnings: [...new Set(warnings)] };
}
