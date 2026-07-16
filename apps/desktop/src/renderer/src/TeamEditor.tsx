import { useMemo, useState } from 'react';
import { calculateLevel50Stats, type StatBlock, type StatPointBlock, type Team, type TeamPokemon, type ValidationResult } from '@pochamp/engine';
import type { BootstrapData } from '../../shared/contracts';

const statFields: Array<{ key: keyof StatBlock; short: string; label: string }> = [
  { key: 'hp', short: 'H', label: 'HP' },
  { key: 'attack', short: 'A', label: '공격' },
  { key: 'defense', short: 'B', label: '방어' },
  { key: 'specialAttack', short: 'C', label: '특공' },
  { key: 'specialDefense', short: 'D', label: '특방' },
  { key: 'speed', short: 'S', label: '스피드' },
];
const emptyStatPoints: StatPointBlock = { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 };
const toID = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

interface Props {
  team: Team;
  savedTeams: Team[];
  regulation: BootstrapData['regulation'];
  validation: ValidationResult | null;
  onChange(team: Team): void;
  onLoad(team: Team): void;
  onNew(): void;
  onSave(): void;
}

export function TeamEditor({ team, savedTeams, regulation, validation, onChange, onLoad, onNew, onSave }: Props) {
  const [speciesSort, setSpeciesSort] = useState<'name' | 'dex-desc'>('name');
  const [speciesQueries, setSpeciesQueries] = useState<Record<number, string>>({});

  const localized = (kind: 'species' | 'move' | 'ability' | 'item' | 'nature', value: string) => {
    if (!value) return '';
    const map = kind === 'species' ? regulation.localization.species
      : kind === 'move' ? regulation.localization.moves
        : kind === 'ability' ? regulation.localization.abilities
          : kind === 'item' ? regulation.localization.items
            : regulation.localization.natures;
    return map[toID(value)] ?? value;
  };

  const sortedSpecies = useMemo(() => [...regulation.species].sort((left, right) => speciesSort === 'dex-desc'
    ? right.nationalDex - left.nationalDex || left.displayName.localeCompare(right.displayName, 'ko-KR')
    : left.displayName.localeCompare(right.displayName, 'ko-KR')), [regulation.species, speciesSort]);

  const updatePokemon = (index: number, patch: Partial<TeamPokemon>) => {
    const pokemon = [...team.pokemon] as Team['pokemon'];
    pokemon[index] = { ...pokemon[index]!, ...patch };
    onChange({ ...team, pokemon, updatedAt: new Date().toISOString() });
  };

  const selectSpecies = (index: number, speciesName: string) => {
    const current = team.pokemon[index]!;
    const options = regulation.species.find((entry) => entry.name === speciesName);
    const moves = current.moves.map((move) => options?.moves.includes(move) ? move : '') as TeamPokemon['moves'];
    const statPoints = { ...emptyStatPoints };
    updatePokemon(index, {
      species: speciesName,
      form: '',
      id: speciesName ? `${toID(speciesName)}-${index}` : `slot-${index + 1}`,
      ability: options?.abilities.includes(current.ability) ? current.ability : options?.abilities[0] ?? '',
      moves,
      statPoints,
      stats: calculateLevel50Stats(speciesName, statPoints, current.statAlignment) ?? current.stats,
      megaEligible: options?.megaEligible ?? false,
    });
  };

  const updateAlignment = (index: number, statAlignment: string) => {
    const pokemon = team.pokemon[index]!;
    updatePokemon(index, {
      statAlignment,
      nature: undefined,
      stats: calculateLevel50Stats(pokemon.species, pokemon.statPoints, statAlignment) ?? pokemon.stats,
    });
  };

  const updateStatPoint = (index: number, stat: keyof StatPointBlock, rawValue: number) => {
    const pokemon = team.pokemon[index]!;
    const otherTotal = Object.entries(pokemon.statPoints).reduce((sum, [key, value]) => key === stat ? sum : sum + value, 0);
    const value = Math.max(0, Math.min(32, 66 - otherTotal, Number.isFinite(rawValue) ? Math.trunc(rawValue) : 0));
    const statPoints = { ...pokemon.statPoints, [stat]: value };
    updatePokemon(index, {
      statPoints,
      stats: calculateLevel50Stats(pokemon.species, statPoints, pokemon.statAlignment) ?? pokemon.stats,
    });
  };

  const usageOf = (values: Array<{ name: string; usage: number }> | undefined, value: string) => values?.find((entry) => toID(entry.name) === toID(value))?.usage;
  const withUsage = (label: string, usage?: number) => usage === undefined ? label : `${label} · ${usage}%`;
  const sortByUsage = (values: string[], usage: Array<{ name: string; usage: number }>, kind: 'item' | 'nature') => [...values].sort((left, right) => {
    const difference = (usageOf(usage, right) ?? -1) - (usageOf(usage, left) ?? -1);
    return difference || localized(kind, left).localeCompare(localized(kind, right), 'ko-KR');
  });

  const alignmentLabel = (alignment: BootstrapData['regulation']['statAlignments'][number], usage?: number) => {
    const nature = localized('nature', alignment.id);
    return withUsage(alignment.raised ? `${nature} · ${alignment.raised}↑ / ${alignment.lowered}↓` : `${nature} · 보정 없음`, usage);
  };

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div><span className="eyebrow">실제 Champions 능력 포인트 기준</span><h2>팀 제작</h2></div>
        <button className="primary" onClick={onSave}>팀 검증 및 저장</button>
      </div>
      <div className="builder-team-bar"><div><b>저장 팀 불러오기</b><span>팀 이름을 누르면 6마리의 모든 설정을 그대로 불러와 수정합니다.</span></div><div>{savedTeams.map((saved) => <button className={saved.id === team.id ? 'active' : ''} key={saved.id} onClick={() => onLoad(saved)}>{saved.name}</button>)}<button onClick={onNew}>＋ 새 팀</button></div></div>
      <div className="notice"><b>성격은 게임의 Stat Alignment와 같은 항목입니다.</b> 기본 종족값에 H/A/B/C/D/S 능력 포인트를 총 66점, 능력치별 최대 32점까지 배분하면 실제 Lv.50 스탯을 자동 계산합니다.</div>
      <div className="meta-note"><b>M-B 사용률 우선 정렬 · {regulation.meta.checkedAt}</b><span>{regulation.meta.limitation}</span></div>
      <div className="editor-toolbar">
        <label className="field wide"><span>팀 이름</span><input value={team.name} onChange={(event) => onChange({ ...team, name: event.target.value })} /></label>
        <label className="field"><span>포켓몬 정렬</span><select value={speciesSort} onChange={(event) => setSpeciesSort(event.target.value as 'name' | 'dex-desc')}><option value="name">가나다순</option><option value="dex-desc">전국도감 번호 내림차순</option></select></label>
      </div>
      {validation && (
        <div className={validation.valid ? 'validation success' : 'validation error'}>
          <strong>{validation.valid ? '팀 검증 통과' : `오류 ${validation.errors.length}개`}</strong>
          {[...validation.errors, ...validation.warnings].map((message) => <div key={message}>• {message}</div>)}
        </div>
      )}
      <div className="team-grid">
        {team.pokemon.map((pokemon, index) => {
          const builder = regulation.species.find((entry) => entry.name === pokemon.species);
          const query = speciesQueries[index]?.trim().toLocaleLowerCase('ko-KR') ?? '';
          const filtered = sortedSpecies.filter((entry) => !query || `${entry.displayName} ${entry.name} ${entry.nationalDex}`.toLocaleLowerCase('ko-KR').includes(query));
          const speciesOptions = builder && !filtered.some((entry) => entry.name === builder.name) ? [builder, ...filtered] : filtered;
          const usedItems = new Set(team.pokemon.filter((_, slot) => slot !== index).map((entry) => toID(entry.heldItem)).filter(Boolean));
          const itemOptions = sortByUsage(regulation.items, builder?.usage.items ?? [], 'item');
          const alignmentOptions = [...regulation.statAlignments].sort((left, right) => {
            const difference = (usageOf(builder?.usage.statAlignments, right.id) ?? -1) - (usageOf(builder?.usage.statAlignments, left.id) ?? -1);
            return difference || localized('nature', left.id).localeCompare(localized('nature', right.id), 'ko-KR');
          });
          const statPointTotal = Object.values(pokemon.statPoints).reduce((sum, value) => sum + value, 0);
          return (
            <article className="pokemon-card" key={pokemon.id}>
              <div className="card-index">{index + 1}</div>
              <div className="species-picker">
                <label className="field"><span>포켓몬 검색 · 한글/영문/도감번호</span><input type="search" value={speciesQueries[index] ?? ''} onChange={(event) => setSpeciesQueries((current) => ({ ...current, [index]: event.target.value }))} placeholder="예: 대짱이" /></label>
                <label className="field"><span>포켓몬/폼 · 전체 {regulation.species.length}개</span><select value={pokemon.species} onChange={(event) => selectSpecies(index, event.target.value)}><option value="">포켓몬을 선택하세요</option>{speciesOptions.map((entry) => <option key={entry.id} value={entry.name}>#{entry.nationalDex} · {entry.displayName}</option>)}</select></label>
              </div>
              <div className="form-grid two">
                <label className="field"><span>성격 (Stat Alignment)</span><select value={pokemon.statAlignment} onChange={(event) => updateAlignment(index, event.target.value)}>{alignmentOptions.map((entry) => <option key={entry.id} value={entry.id}>{alignmentLabel(entry, usageOf(builder?.usage.statAlignments, entry.id))}</option>)}</select></label>
                <label className="field"><span>특성 · {builder?.abilities.length ?? 0}개</span><select disabled={!builder} value={pokemon.ability} onChange={(event) => updatePokemon(index, { ability: event.target.value })}><option value="">특성 선택</option>{builder?.abilities.map((ability) => <option key={ability} value={ability}>{withUsage(localized('ability', ability), usageOf(builder.usage.abilities, ability))}</option>)}</select></label>
                <label className="field"><span>지닌 도구 · 사용률 우선</span><select value={pokemon.heldItem} onChange={(event) => updatePokemon(index, { heldItem: event.target.value })}><option value="">도구 없음</option>{pokemon.heldItem && !regulation.items.includes(pokemon.heldItem) && <option value={pokemon.heldItem}>현재 규정 외 · {localized('item', pokemon.heldItem)}</option>}{itemOptions.map((item) => <option disabled={usedItems.has(toID(item))} key={item} value={item}>{withUsage(localized('item', item), usageOf(builder?.usage.items, item))}{usedItems.has(toID(item)) ? ' · 다른 슬롯 사용 중' : ''}</option>)}</select></label>
                <div className="option-summary">{builder?.usage.rank ? `메타 사용률 데이터 #${builder.usage.rank}` : '사용률 미확인 항목은 가나다순'}</div>
              </div>
              <div className="move-grid">
                {pokemon.moves.map((move, moveIndex) => (
                  <label className="field" key={moveIndex}><span>기술 {moveIndex + 1}</span><select disabled={!builder} value={move} onChange={(event) => {
                    const moves = [...pokemon.moves] as TeamPokemon['moves'];
                    moves[moveIndex] = event.target.value;
                    updatePokemon(index, { moves });
                  }}><option value="">기술 선택</option>{move && !builder?.moves.includes(move) && <option value={move}>현재 규정 외 · {localized('move', move)}</option>}{builder?.moves.map((moveName) => <option disabled={pokemon.moves.some((selected, selectedIndex) => selectedIndex !== moveIndex && selected === moveName)} key={moveName} value={moveName}>{withUsage(localized('move', moveName), usageOf(builder.usage.moves, moveName))}</option>)}</select></label>
                ))}
              </div>
              <div className="stat-section"><div className="stat-title"><b>기본 종족값</b><span>포켓몬 고유 수치</span></div><div className="stats-grid">{statFields.map(({ key, short, label }) => <div className="stat-readout" key={key}><span>{short} · {label}</span><strong>{builder?.baseStats[key] ?? '-'}</strong></div>)}</div></div>
              <div className="stat-section"><div className="stat-title"><b>능력 포인트</b><span className={statPointTotal === 66 ? 'complete' : ''}>{statPointTotal}/66 · 남음 {66 - statPointTotal}</span></div><div className="stats-grid">{statFields.map(({ key, short, label }) => <label className="field compact" key={key}><span>{short} · {label}</span><input type="number" min="0" max="32" disabled={!builder} value={pokemon.statPoints[key]} onChange={(event) => updateStatPoint(index, key, Number(event.target.value))} /></label>)}</div></div>
              <div className="stat-section actual"><div className="stat-title"><b>실제 Lv.50 스탯</b><span>성격 보정 적용</span></div><div className="stats-grid">{statFields.map(({ key, short, label }) => <div className="stat-readout" key={key}><span>{short} · {label}</span><strong>{pokemon.stats[key]}</strong></div>)}</div></div>
              <div className="inline-fields"><span className="option-summary">선택 가능 기술 {builder?.moves.length ?? 0}개</span><label className="check"><input type="checkbox" checked={pokemon.megaEligible} onChange={(event) => updatePokemon(index, { megaEligible: event.target.checked })} />메가진화 가능</label></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
