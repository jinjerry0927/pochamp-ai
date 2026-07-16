import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BattlePokemonState, BattleState, PreviewRecommendation, Recommendation, Team, VisionResult } from '@pochamp/engine';
import type { BootstrapData, HistoryEntry, LocalVisionSlot, VisionReferenceStatus } from '../../shared/contracts';
import { battlePokemonState } from './model';
import { RecommendationCard } from './RecommendationCard';

interface Props {
  team: Team | null;
  regulation: BootstrapData['regulation'];
  onHistory(history: HistoryEntry[]): void;
}

const emptyPreviewSlots = (): string[] => Array.from({ length: 6 }, () => '');
const splitSpecies = (value: string) => value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean).slice(0, 6);
const splitMoves = (value: string) => value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean).slice(0, 4);
const statusOptions: Array<[BattlePokemonState['status'], string]> = [
  ['none', '정상'], ['sleep', '잠듦'], ['burn', '화상'], ['poison', '독'], ['toxic', '맹독'], ['paralysis', '마비'], ['freeze', '얼음'], ['unknown', '미확인'],
];

export function BattleAssistant({ team, regulation, onHistory }: Props) {
  const [opponentText, setOpponentText] = useState('');
  const [previewSlots, setPreviewSlots] = useState<string[]>(emptyPreviewSlots);
  const [opponentActive, setOpponentActive] = useState('');
  const [ownActiveId, setOwnActiveId] = useState('');
  const [ownHp, setOwnHp] = useState(100);
  const [opponentHp, setOpponentHp] = useState(100);
  const [turn, setTurn] = useState(1);
  const [ownStatus, setOwnStatus] = useState<BattlePokemonState['status']>('none');
  const [opponentStatus, setOpponentStatus] = useState<BattlePokemonState['status']>('none');
  const [ownDrowsy, setOwnDrowsy] = useState(false);
  const [opponentDrowsy, setOpponentDrowsy] = useState(false);
  const [weather, setWeather] = useState<BattleState['weather']>('none');
  const [terrain, setTerrain] = useState<BattleState['terrain']>('none');
  const [trickRoomTurns, setTrickRoomTurns] = useState(0);
  const [opponentMoves, setOpponentMoves] = useState('');
  const [monitoring, setMonitoring] = useState(false);
  const [vision, setVision] = useState<VisionResult | null>(null);
  const [localVisionSlots, setLocalVisionSlots] = useState<LocalVisionSlot[]>([]);
  const [referenceStatus, setReferenceStatus] = useState<VisionReferenceStatus | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [screenshot, setScreenshot] = useState('');
  const [confirmed, setConfirmed] = useState(true);
  const [status, setStatus] = useState('수동 입력 준비');
  const [busy, setBusy] = useState(false);
  const [previewRecommendation, setPreviewRecommendation] = useState<PreviewRecommendation | null>(null);
  const [turnRecommendation, setTurnRecommendation] = useState<Recommendation | null>(null);
  const captureInFlight = useRef(false);
  const lastAutoRecommendation = useRef('');

  useEffect(() => {
    if (team && !ownActiveId) setOwnActiveId(team.pokemon[0]?.id ?? '');
  }, [team, ownActiveId]);

  useEffect(() => {
    void window.pochamp.getVisionReferenceStatus().then(setReferenceStatus);
  }, []);

  const speciesOptions = useMemo(
    () => [...regulation.species].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko')),
    [regulation.species],
  );
  const speciesName = useCallback(
    (name: string) => regulation.localization.species[name] ?? regulation.species.find((entry) => entry.name === name)?.displayName ?? name,
    [regulation],
  );
  const resolveSpeciesName = useCallback((value: string) => {
    const normalized = value.trim().toLocaleLowerCase('ko-KR');
    return regulation.species.find((entry) => entry.name.toLocaleLowerCase('en-US') === normalized || entry.displayName.toLocaleLowerCase('ko-KR') === normalized)?.name ?? null;
  }, [regulation.species]);
  const opponentSpecies = useMemo(
    () => splitSpecies(opponentText).map(resolveSpeciesName).filter((species): species is string => Boolean(species)),
    [opponentText, resolveSpeciesName],
  );
  const selectedIds = previewRecommendation?.selectedPokemonIds ?? team?.pokemon.slice(0, 3).map((pokemon) => pokemon.id) ?? [];
  const selectedOrder = useMemo(() => {
    if (!previewRecommendation) return [];
    return [previewRecommendation.leadPokemonId, ...previewRecommendation.selectedPokemonIds.filter((id) => id !== previewRecommendation.leadPokemonId)];
  }, [previewRecommendation]);

  const applyPreviewSlots = (slots: string[], needsConfirmation: boolean) => {
    const normalized = Array.from({ length: 6 }, (_, index) => slots[index] ?? '');
    setPreviewSlots(normalized);
    setOpponentText(normalized.filter(Boolean).map(speciesName).join('\n'));
    setConfirmed(!needsConfirmation);
  };

  const updatePreviewSlot = (index: number, value: string) => {
    const next = [...previewSlots];
    next[index] = value;
    applyPreviewSlots(next, false);
  };

  const updateOpponentText = (value: string) => {
    setOpponentText(value);
    const parsed = splitSpecies(value).map((entry) => resolveSpeciesName(entry) ?? '');
    setPreviewSlots(Array.from({ length: 6 }, (_, index) => parsed[index] ?? ''));
    setConfirmed(true);
  };

  const capture = useCallback(async () => {
    if (captureInFlight.current) return;
    captureInFlight.current = true;
    setBusy(true);
    setStatus('BlueStacks 화면을 읽는 중…');
    try {
      const result = await window.pochamp.analyzeCapture();
      if (result.duplicate) {
        setStatus(result.warning ?? '중복 프레임입니다.');
        return;
      }
      setScreenshot(result.screenshot ?? '');
      setVision(result.vision ?? null);
      const localSlots = result.localVisionSlots ?? [];
      setLocalVisionSlots(localSlots);
      setConfirmed(false);
      if (result.vision) {
        const slots = emptyPreviewSlots();
        if (result.vision.opponentPreviewSlots.length) {
          for (const recognized of result.vision.opponentPreviewSlots) {
            slots[recognized.slot - 1] = recognized.species ?? recognized.candidates[0] ?? '';
          }
        } else {
          result.vision.opponentPreview.forEach((species, index) => { slots[index] = species; });
        }
        if (slots.some(Boolean)) applyPreviewSlots(slots, true);
        if (result.vision.opponentActiveSpecies) setOpponentActive(result.vision.opponentActiveSpecies);
        if (result.vision.ownActiveSpecies && team) {
          setOwnActiveId(team.pokemon.find((pokemon) => pokemon.species === result.vision?.ownActiveSpecies)?.id ?? ownActiveId);
        }
        if (result.vision.ownHpPercent !== null) setOwnHp(result.vision.ownHpPercent);
        if (result.vision.opponentHpPercent !== null) setOpponentHp(result.vision.opponentHpPercent);
        if (result.vision.ownStatus !== null) setOwnStatus(result.vision.ownStatus);
        if (result.vision.opponentStatus !== null) setOpponentStatus(result.vision.opponentStatus);
        setOwnDrowsy(result.vision.ownVolatileStatuses.includes('drowsy'));
        setOpponentDrowsy(result.vision.opponentVolatileStatuses.includes('drowsy'));
        if (result.vision.weather !== null) setWeather(result.vision.weather);
        if (result.vision.terrain !== null) setTerrain(result.vision.terrain);
        if (result.vision.trickRoomTurns !== null) setTrickRoomTurns(result.vision.trickRoomTurns);
        if (result.vision.visibleMoves.length) setOpponentMoves(result.vision.visibleMoves.join('\n'));
        const autoConfirmed = monitoring
          && result.vision.phase === 'turn'
          && result.vision.confidence >= 0.82
          && Boolean(result.vision.opponentActiveSpecies)
          && Boolean(result.vision.ownActiveSpecies || ownActiveId);
        setConfirmed(autoConfirmed);
        if (autoConfirmed) setStatus(`연속 분석 상태 자동 확인 · 신뢰도 ${Math.round(result.vision.confidence * 100)}%`);
      }
      if (!result.vision && localSlots.some((slot) => slot.candidates.length)) {
        applyPreviewSlots(localSlots.map((slot) => slot.candidates[0]?.species ?? ''), true);
      }
      if (!result.vision || !monitoring || result.vision.confidence < 0.82) setStatus(result.warning ?? `인식 초안 완료 · ${result.latencyMs}ms`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      captureInFlight.current = false;
      setBusy(false);
    }
  }, [monitoring, team, ownActiveId]);

  useEffect(() => window.pochamp.onCaptureHotkey(capture), [capture]);

  const record = useCallback(async (kind: 'preview' | 'turn', recommendation: PreviewRecommendation | Recommendation) => {
    if (!team) return;
    const entry: HistoryEntry = {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind, teamName: team.name,
      opponent: opponentSpecies, recommendation,
    };
    onHistory(await window.pochamp.addHistory(entry));
  }, [onHistory, opponentSpecies, team]);

  const runPreview = async () => {
    if (!team || opponentSpecies.length < 3) {
      setStatus('상대 포켓몬을 3마리 이상 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const recommendation = await window.pochamp.recommendPreview({ team, opponentSpecies });
      setPreviewRecommendation(recommendation);
      setOwnActiveId(recommendation.leadPokemonId);
      await record('preview', recommendation);
      setStatus('출전 추천 완료');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const runTurn = useCallback(async () => {
    if (!team || !opponentActive || !confirmed) {
      setStatus(!confirmed ? '인식 결과를 먼저 확인해 주세요.' : '팀과 상대 활성 포켓몬이 필요합니다.');
      return;
    }
    const active = team.pokemon.find((pokemon) => pokemon.id === ownActiveId);
    if (!active) {
      setStatus('내 활성 포켓몬을 선택해 주세요.');
      return;
    }
    const resolvedOpponentActive = resolveSpeciesName(opponentActive);
    if (!resolvedOpponentActive) {
      setStatus('상대 활성 포켓몬을 현재 규정 목록에서 선택해 주세요.');
      return;
    }
    const selected = team.pokemon.filter((pokemon) => selectedIds.includes(pokemon.id));
    const state: BattleState = {
      phase: 'turn', turn, selectedOwnIds: selectedIds, opponentPreview: opponentSpecies,
      ownActive: { ...battlePokemonState(active, ownHp), status: ownStatus, volatileStatuses: ownDrowsy ? ['drowsy'] : [] },
      opponentActive: {
        species: resolvedOpponentActive, currentHp: opponentHp, maxHp: 100, status: opponentStatus, volatileStatuses: opponentDrowsy ? ['drowsy'] : [], fainted: opponentHp <= 0,
        boosts: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
        remainingPp: {}, revealedMoves: splitMoves(opponentMoves),
      },
      ownBench: selected.filter((pokemon) => pokemon.id !== active.id).map((pokemon) => battlePokemonState(pokemon)),
      opponentBench: [], weather, terrain, ownHazards: [], opponentHazards: [],
      ownMegaUsed: false, opponentMegaUsed: false, trickRoomTurns,
    };
    setBusy(true);
    try {
      const recommendation = await window.pochamp.recommendTurn({ team, state, rolloutCount: 256 });
      setTurnRecommendation(recommendation);
      await record('turn', recommendation);
      setStatus(`턴 ${turn} 행동 추천 완료`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [confirmed, opponentActive, opponentDrowsy, opponentHp, opponentMoves, opponentSpecies, opponentStatus, ownActiveId, ownDrowsy, ownHp, ownStatus, record, resolveSpeciesName, selectedIds, team, terrain, trickRoomTurns, turn, weather]);

  useEffect(() => {
    if (!monitoring || !confirmed || !vision || vision.phase !== 'turn' || busy) return;
    const signature = JSON.stringify([vision, ownActiveId, opponentActive, ownHp, opponentHp, ownStatus, opponentStatus, ownDrowsy, opponentDrowsy, weather, terrain, trickRoomTurns, opponentMoves]);
    if (lastAutoRecommendation.current === signature) return;
    lastAutoRecommendation.current = signature;
    void runTurn();
  }, [busy, confirmed, monitoring, opponentActive, opponentDrowsy, opponentHp, opponentMoves, opponentStatus, ownActiveId, ownDrowsy, ownHp, ownStatus, runTurn, terrain, trickRoomTurns, vision, weather]);

  useEffect(() => {
    if (!monitoring) return;
    void capture();
    const timer = window.setInterval(() => void capture(), 6_000);
    return () => window.clearInterval(timer);
  }, [capture, monitoring]);

  const seedReferences = async () => {
    setReferenceBusy(true);
    setStatus('현재 규정 235개 폼의 Champions 선택 화면 참조 이미지를 내려받는 중…');
    try {
      const next = await window.pochamp.seedVisionReferences();
      setReferenceStatus(next);
      setStatus(`초기 참조팩 준비 완료 · ${next.seededSpecies}/${next.totalSpecies}종`);
    } catch (error) {
      setStatus(`참조팩 준비 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReferenceBusy(false);
    }
  };

  const learnCurrentPreview = async () => {
    if (!confirmed || localVisionSlots.length !== 6 || previewSlots.some((species) => !species)) {
      setStatus('6개 슬롯의 정답을 모두 선택하고 인식 결과를 확인해 주세요.');
      return;
    }
    setReferenceBusy(true);
    try {
      const next = await window.pochamp.learnVisionReferences(localVisionSlots.map((slot) => ({
        slot: slot.slot,
        species: previewSlots[slot.slot - 1] ?? '',
        imageDataUrl: slot.imageDataUrl,
      })));
      setReferenceStatus(next);
      setStatus(`Champions 정답 이미지 6개를 로컬 학습본으로 저장했습니다 · 학습된 포켓몬 ${next.learnedSpecies}종`);
    } catch (error) {
      setStatus(`이미지 학습 저장 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReferenceBusy(false);
    }
  };

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div><span className="eyebrow">BlueStacks 캡처 · 친선전</span><h2>배틀 도우미</h2></div>
        <div className="capture-controls"><button className={monitoring ? 'monitor-button active' : 'monitor-button'} onClick={() => { setMonitoring((current) => !current); setStatus(monitoring ? '연속 화면 분석을 중지했습니다.' : '연속 화면 분석을 시작합니다. 6초마다 변경 화면을 확인합니다.'); }}>{monitoring ? '● 연속 분석 중지' : '○ 연속 화면 분석'}</button><button className="capture-button" disabled={busy} onClick={capture}><kbd>Ctrl Shift Space</kbd>{busy ? '분석 중…' : '현재 화면 캡처'}</button></div>
      </div>
      <div className="status-line"><span className={busy ? 'pulse' : ''} />{status}</div>
      {monitoring && <div className="monitor-notice">화면이 바뀐 프레임만 NVIDIA로 전송합니다. 신뢰도 82% 이상인 턴은 상태를 자동 반영해 행동을 다시 추천하며, 게임 조작은 하지 않습니다.</div>}
      {!team && <div className="validation error">먼저 ‘내 팀’에서 정확한 6마리 팀을 저장하세요.</div>}
      <div className="vision-reference-bar">
        <div><b>로컬 이미지 참조팩</b><span>{referenceStatus ? `선택 화면 ${referenceStatus.seededSpecies}/${referenceStatus.totalSpecies}종 · Champions 학습 ${referenceStatus.learnedSpecies}종 · 총 ${referenceStatus.referenceCount}장${referenceStatus.seedCurrent ? ' · 최신' : ' · 업데이트 필요'}` : '상태 확인 중'}</span></div>
        <button disabled={referenceBusy || (referenceStatus?.missingSpecies === 0 && referenceStatus.seedCurrent)} onClick={() => void seedReferences()}>{referenceBusy ? '처리 중…' : referenceStatus?.missingSpecies === 0 && referenceStatus.seedCurrent ? '참조팩 준비됨' : referenceStatus?.seededSpecies ? '참조팩 업데이트' : '235종 참조 이미지 받기'}</button>
        <button className="primary" disabled={referenceBusy || !confirmed || localVisionSlots.length !== 6 || previewSlots.some((species) => !species)} onClick={() => void learnCurrentPreview()}>확정한 6마리 이미지 학습</button>
      </div>
      <div className="battle-layout">
        <div className="battle-inputs">
          {screenshot && <div className="capture-preview"><img src={screenshot} alt="BlueStacks 캡처" /><span>원본 프레임은 메모리에만 유지됩니다. ‘이미지 학습’을 누르면 상대 슬롯 6개만 사용자 데이터 폴더에 저장됩니다.</span></div>}
          {vision && (
            <div className="vision-summary">
              <b>NVIDIA 인식 신뢰도 {Math.round(vision.confidence * 100)}%</b>
              <span>{vision.unknownFields.length ? `확인 필요: ${vision.unknownFields.join(', ')}` : '필수 필드 인식 완료'}</span>
            </div>
          )}

          <div className="preview-slot-section">
            <div className="preview-slot-heading"><b>상대 팀 미리보기</b><span>아이콘 인식 결과를 슬롯별로 확인하세요.</span></div>
            <div className="preview-slot-grid">
              {previewSlots.map((value, index) => {
                const recognized = vision?.opponentPreviewSlots.find((slot) => slot.slot === index + 1);
                const local = localVisionSlots.find((slot) => slot.slot === index + 1);
                return (
                  <label className="preview-slot" key={index}>
                    <span>슬롯 {index + 1}</span>
                    {local && <img className="preview-slot-image" src={local.imageDataUrl} alt={`상대 슬롯 ${index + 1}`} />}
                    <select value={value} onChange={(event) => updatePreviewSlot(index, event.target.value)}>
                      <option value="">미확인</option>
                      {speciesOptions.map((entry) => <option key={entry.id} value={entry.name}>{entry.displayName}</option>)}
                    </select>
                    {recognized && (
                      <small>
                        신뢰도 {Math.round(recognized.confidence * 100)}%
                        {recognized.candidates.length ? ` · 후보 ${recognized.candidates.map(speciesName).join(', ')}` : ''}
                        {recognized.evidence ? ` · ${recognized.evidence}` : ''}
                      </small>
                    )}
                    {local?.candidates.length ? <small className="local-candidates">로컬 Top 3 · {local.candidates.map((candidate) => `${speciesName(candidate.species)} ${Math.round(candidate.confidence * 100)}%${candidate.source === 'learned' ? '★' : ''}`).join(' · ')}</small> : null}
                  </label>
                );
              })}
            </div>
          </div>

          {!confirmed && <button className="confirm-button" onClick={() => { setConfirmed(true); setStatus('상태 확인 완료'); }}>인식 결과를 확인했습니다</button>}
          <label className="field">
            <span>빠른 일괄 수정 · 한 줄에 한 마리</span>
            <textarea rows={4} value={opponentText} onChange={(event) => updateOpponentText(event.target.value)} placeholder={'리자몽\n거북왕\n이상해꽃'} />
          </label>
          <button className="primary full" disabled={!team || busy || opponentSpecies.length < 3} onClick={runPreview}>출전 3마리와 선봉 추천</button>
          {previewRecommendation && (
            <><div className="selection-ranking">{selectedOrder.map((id, index) => <div key={id}><b>{index + 1}순위</b><strong>{speciesName(team?.pokemon.find((pokemon) => pokemon.id === id)?.species ?? id)}</strong><span>{index === 0 ? '선봉' : previewRecommendation.roles[id]}</span></div>)}</div><div className="roles">{Object.entries(previewRecommendation.roles).map(([id, role]) => <div key={id}><b>{speciesName(team?.pokemon.find((pokemon) => pokemon.id === id)?.species ?? id)}</b><span>{role}</span></div>)}</div></>
          )}
          <div className="turn-fields">
            <label className="field"><span>현재 턴</span><input type="number" min="1" value={turn} onChange={(event) => setTurn(Math.max(1, Number(event.target.value)))} /></label>
            <label className="field"><span>내 활성 포켓몬</span><select value={ownActiveId} onChange={(event) => setOwnActiveId(event.target.value)}>{team?.pokemon.filter((pokemon) => selectedIds.includes(pokemon.id)).map((pokemon) => <option key={pokemon.id} value={pokemon.id}>{speciesName(pokemon.species)}</option>)}</select></label>
            <label className="field"><span>상대 활성 포켓몬</span><input list="battle-species-list" value={opponentActive} onChange={(event) => setOpponentActive(event.target.value)} /></label>
            <label className="field"><span>내 HP %</span><input type="number" min="0" max="100" value={ownHp} onChange={(event) => setOwnHp(Number(event.target.value))} /></label>
            <label className="field"><span>상대 HP %</span><input type="number" min="0" max="100" value={opponentHp} onChange={(event) => setOpponentHp(Number(event.target.value))} /></label>
            <label className="field"><span>내 상태</span><select value={ownStatus} onChange={(event) => setOwnStatus(event.target.value as BattlePokemonState['status'])}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field"><span>상대 상태</span><select value={opponentStatus} onChange={(event) => setOpponentStatus(event.target.value as BattlePokemonState['status'])}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="check state-check"><input type="checkbox" checked={ownDrowsy} onChange={(event) => setOwnDrowsy(event.target.checked)} />내 포켓몬이 하품으로 다음 턴 잠듦</label>
            <label className="check state-check"><input type="checkbox" checked={opponentDrowsy} onChange={(event) => setOpponentDrowsy(event.target.checked)} />상대가 하품으로 다음 턴 잠듦</label>
            <label className="field"><span>날씨</span><select value={weather} onChange={(event) => setWeather(event.target.value as BattleState['weather'])}><option value="none">없음</option><option value="rain">비</option><option value="sun">쾌청</option><option value="sand">모래바람</option><option value="snow">설경</option><option value="unknown">미확인</option></select></label>
            <label className="field"><span>필드</span><select value={terrain} onChange={(event) => setTerrain(event.target.value as BattleState['terrain'])}><option value="none">없음</option><option value="electric">일렉트릭</option><option value="grassy">그래스</option><option value="misty">미스트</option><option value="psychic">사이코</option><option value="unknown">미확인</option></select></label>
            <label className="field"><span>트릭룸 남은 턴</span><input type="number" min="0" max="5" value={trickRoomTurns} onChange={(event) => setTrickRoomTurns(Math.max(0, Math.min(5, Number(event.target.value))))} /></label>
            <label className="field"><span>상대가 공개한 기술 · 쉼표/줄바꿈</span><textarea rows={2} value={opponentMoves} onChange={(event) => setOpponentMoves(event.target.value)} placeholder={'하품\n트릭룸'} /></label>
          </div>
          <button className="primary full" disabled={!team || busy || !opponentActive} onClick={runTurn}>현재 상태로 행동 1~3순위 추천</button>
        </div>
        <div className="recommendation-column">
          {turnRecommendation ? <RecommendationCard recommendation={turnRecommendation} /> : previewRecommendation ? <RecommendationCard recommendation={previewRecommendation} /> : <div className="empty-recommendation"><span>AI</span><h3>추천 대기 중</h3><p>팀 미리보기나 현재 턴 상태를 입력하면 근거와 대안을 비교합니다.</p></div>}
        </div>
      </div>
    </section>
  );
}
