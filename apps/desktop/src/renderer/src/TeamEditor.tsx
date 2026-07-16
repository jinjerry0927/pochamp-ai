import type { Team, TeamPokemon, ValidationResult } from '@pochamp/engine';
import type { BootstrapData } from '../../shared/contracts';

const statLabels: Array<[keyof TeamPokemon['stats'], string]> = [
  ['hp', 'HP'], ['attack', '공격'], ['defense', '방어'], ['specialAttack', '특공'], ['specialDefense', '특방'], ['speed', '스피드'],
];

interface Props {
  team: Team;
  regulation: BootstrapData['regulation'];
  validation: ValidationResult | null;
  onChange(team: Team): void;
  onSave(): void;
}

export function TeamEditor({ team, regulation, validation, onChange, onSave }: Props) {
  const updatePokemon = (index: number, patch: Partial<TeamPokemon>) => {
    const pokemon = [...team.pokemon] as Team['pokemon'];
    pokemon[index] = { ...pokemon[index]!, ...patch };
    onChange({ ...team, pokemon, updatedAt: new Date().toISOString() });
  };

  const selectSpecies = (index: number, speciesName: string) => {
    const current = team.pokemon[index]!;
    const options = regulation.species.find((entry) => entry.name === speciesName);
    const moves = current.moves.map((move) => options?.moves.includes(move) ? move : '') as TeamPokemon['moves'];
    updatePokemon(index, {
      species: speciesName,
      form: '',
      id: speciesName ? `${speciesName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}` : `slot-${index + 1}`,
      ability: options?.abilities.includes(current.ability) ? current.ability : options?.abilities[0] ?? '',
      moves,
      megaEligible: options?.megaEligible ?? false,
    });
  };

  const alignmentLabel = (alignment: BootstrapData['regulation']['statAlignments'][number]) => alignment.raised
    ? `${alignment.id} · ${alignment.raised}↑ / ${alignment.lowered}↓`
    : `${alignment.id} · 보정 없음`;

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div><span className="eyebrow">정확한 계산의 기준</span><h2>내 팀 등록</h2></div>
        <button className="primary" onClick={onSave}>팀 검증 후 저장</button>
      </div>
      <div className="notice"><b>Stat Alignment는 기존 시리즈의 성격 능력 보정과 같은 기능입니다.</b> 실제 Lv.50 스탯에는 이미 보정이 반영되어 있으므로 계산은 입력 스탯을 최우선으로 사용하고, 선택값은 팀 정보와 상대 세트 추론에 보존합니다.</div>
      <label className="field wide"><span>팀 이름</span><input value={team.name} onChange={(event) => onChange({ ...team, name: event.target.value })} /></label>
      {validation && (
        <div className={validation.valid ? 'validation success' : 'validation error'}>
          <strong>{validation.valid ? '팀 검증 통과' : `오류 ${validation.errors.length}개`}</strong>
          {[...validation.errors, ...validation.warnings].map((message) => <div key={message}>• {message}</div>)}
        </div>
      )}
      <div className="team-grid">
        {team.pokemon.map((pokemon, index) => {
          const builder = regulation.species.find((entry) => entry.name === pokemon.species);
          return (
          <article className="pokemon-card" key={pokemon.id}>
            <div className="card-index">{index + 1}</div>
            <div className="form-grid two">
              <label className="field"><span>포켓몬/폼 · 전체 {regulation.species.length}개</span><select value={pokemon.species} onChange={(event) => selectSpecies(index, event.target.value)}><option value="">포켓몬/폼 선택</option>{regulation.species.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
              <label className="field"><span>성격(Stat Alignment)</span><select value={pokemon.statAlignment} onChange={(event) => updatePokemon(index, { statAlignment: event.target.value, nature: undefined })}>{regulation.statAlignments.map((alignment) => <option key={alignment.id} value={alignment.id}>{alignmentLabel(alignment)}</option>)}</select></label>
              <label className="field"><span>특성 · {builder?.abilities.length ?? 0}개</span><select disabled={!builder} value={pokemon.ability} onChange={(event) => updatePokemon(index, { ability: event.target.value })}><option value="">특성 선택</option>{builder?.abilities.map((ability) => <option key={ability} value={ability}>{ability}</option>)}</select></label>
              <label className="field"><span>지닌 도구 · M-B {regulation.items.length}개</span><select value={pokemon.heldItem} onChange={(event) => updatePokemon(index, { heldItem: event.target.value })}><option value="">도구 없음</option>{pokemon.heldItem && !regulation.items.includes(pokemon.heldItem) && <option value={pokemon.heldItem}>현재 규정 외 · {pokemon.heldItem}</option>}{regulation.items.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
            <div className="move-grid">
              {pokemon.moves.map((move, moveIndex) => (
                <label className="field" key={moveIndex}><span>기술 {moveIndex + 1}</span><select disabled={!builder} value={move} onChange={(event) => {
                  const moves = [...pokemon.moves] as TeamPokemon['moves'];
                  moves[moveIndex] = event.target.value;
                  updatePokemon(index, { moves });
                }}><option value="">기술 선택</option>{move && !builder?.moves.includes(move) && <option value={move}>현재 규정 외 · {move}</option>}{builder?.moves.map((moveName) => <option disabled={pokemon.moves.some((selected, selectedIndex) => selectedIndex !== moveIndex && selected === moveName)} key={moveName} value={moveName}>{moveName}</option>)}</select></label>
              ))}
            </div>
            <div className="stats-grid">
              {statLabels.map(([stat, label]) => (
                <label className="field compact" key={stat}><span>{label}</span><input type="number" min="1" value={pokemon.stats[stat]} onChange={(event) => updatePokemon(index, { stats: { ...pokemon.stats, [stat]: Number(event.target.value) } })} /></label>
              ))}
            </div>
            <div className="inline-fields"><span className="option-summary">선택 가능 기술 {builder?.moves.length ?? 0}개</span><label className="check"><input type="checkbox" checked={pokemon.megaEligible} onChange={(event) => updatePokemon(index, { megaEligible: event.target.checked })} />메가진화 가능</label></div>
          </article>
          );
        })}
      </div>
    </section>
  );
}
