import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BattleState, PreviewRecommendation, Recommendation, Team, VisionResult } from '@pochamp/engine';
import type { HistoryEntry } from '../../shared/contracts';
import { battlePokemonState } from './model';
import { RecommendationCard } from './RecommendationCard';

interface Props {
  team: Team | null;
  onHistory(history: HistoryEntry[]): void;
}

const splitSpecies = (value: string) => value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean).slice(0, 6);

export function BattleAssistant({ team, onHistory }: Props) {
  const [opponentText, setOpponentText] = useState('');
  const [opponentActive, setOpponentActive] = useState('');
  const [ownActiveId, setOwnActiveId] = useState('');
  const [ownHp, setOwnHp] = useState(100);
  const [opponentHp, setOpponentHp] = useState(100);
  const [vision, setVision] = useState<VisionResult | null>(null);
  const [screenshot, setScreenshot] = useState('');
  const [confirmed, setConfirmed] = useState(true);
  const [status, setStatus] = useState('수동 입력 준비');
  const [busy, setBusy] = useState(false);
  const [previewRecommendation, setPreviewRecommendation] = useState<PreviewRecommendation | null>(null);
  const [turnRecommendation, setTurnRecommendation] = useState<Recommendation | null>(null);

  useEffect(() => {
    if (team && !ownActiveId) setOwnActiveId(team.pokemon[0]?.id ?? '');
  }, [team, ownActiveId]);

  const opponentSpecies = useMemo(() => splitSpecies(opponentText), [opponentText]);
  const selectedIds = previewRecommendation?.selectedPokemonIds ?? team?.pokemon.slice(0, 3).map((pokemon) => pokemon.id) ?? [];

  const capture = useCallback(async () => {
    setBusy(true);
    setStatus('BlueStacks 화면을 읽는 중…');
    try {
      const result = await window.pochamp.analyzeCapture();
      if (result.duplicate) { setStatus(result.warning ?? '중복 프레임'); return; }
      setScreenshot(result.screenshot ?? '');
      setVision(result.vision ?? null);
      setConfirmed(false);
      if (result.vision) {
        if (result.vision.opponentPreview.length) setOpponentText(result.vision.opponentPreview.join('\n'));
        if (result.vision.opponentActiveSpecies) setOpponentActive(result.vision.opponentActiveSpecies);
        if (result.vision.ownActiveSpecies && team) setOwnActiveId(team.pokemon.find((pokemon) => pokemon.species === result.vision!.ownActiveSpecies)?.id ?? ownActiveId);
        if (result.vision.ownHpPercent !== null) setOwnHp(result.vision.ownHpPercent);
        if (result.vision.opponentHpPercent !== null) setOpponentHp(result.vision.opponentHpPercent);
      }
      setStatus(result.warning ?? `인식 초안 완료 · ${result.latencyMs}ms`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [team, ownActiveId]);

  useEffect(() => window.pochamp.onCaptureHotkey(capture), [capture]);

  const record = async (kind: 'preview' | 'turn', recommendation: PreviewRecommendation | Recommendation) => {
    if (!team) return;
    const entry: HistoryEntry = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind, teamName: team.name, opponent: opponentSpecies, recommendation };
    onHistory(await window.pochamp.addHistory(entry));
  };

  const runPreview = async () => {
    if (!team || opponentSpecies.length < 3) { setStatus('팀과 상대 포켓몬 3마리 이상이 필요합니다.'); return; }
    setBusy(true);
    try {
      const recommendation = await window.pochamp.recommendPreview({ team, opponentSpecies });
      setPreviewRecommendation(recommendation);
      setOwnActiveId(recommendation.leadPokemonId);
      await record('preview', recommendation);
      setStatus('선출 추천 완료');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const runTurn = async () => {
    if (!team || !opponentActive || !confirmed) { setStatus(!confirmed ? '인식 결과를 먼저 확인해 주세요.' : '내 팀과 상대 활성 포켓몬이 필요합니다.'); return; }
    const active = team.pokemon.find((pokemon) => pokemon.id === ownActiveId);
    if (!active) { setStatus('내 활성 포켓몬을 선택하세요.'); return; }
    const selected = team.pokemon.filter((pokemon) => selectedIds.includes(pokemon.id));
    const ownActiveState = battlePokemonState(active, ownHp);
    const opponentMaxHp = 100;
    const state: BattleState = {
      phase: 'turn', turn: 1, selectedOwnIds: selectedIds, opponentPreview: opponentSpecies,
      ownActive: ownActiveState,
      opponentActive: {
        species: opponentActive, currentHp: opponentHp, maxHp: opponentMaxHp, status: 'none', fainted: opponentHp <= 0,
        boosts: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, accuracy: 0, evasion: 0 }, remainingPp: {}, revealedMoves: vision?.visibleMoves ?? [],
      },
      ownBench: selected.filter((pokemon) => pokemon.id !== active.id).map((pokemon) => battlePokemonState(pokemon)),
      opponentBench: [], weather: 'none', terrain: 'none', ownHazards: [], opponentHazards: [], ownMegaUsed: false, opponentMegaUsed: false,
    };
    setBusy(true);
    try {
      const recommendation = await window.pochamp.recommendTurn({ team, state, rolloutCount: 256 });
      setTurnRecommendation(recommendation);
      await record('turn', recommendation);
      setStatus('턴 추천 완료');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div><span className="eyebrow">BlueStacks 싱글 친선전</span><h2>배틀 도우미</h2></div>
        <button className="capture-button" disabled={busy} onClick={capture}><kbd>Ctrl Shift Space</kbd>{busy ? '분석 중…' : '현재 화면 캡처'}</button>
      </div>
      <div className="status-line"><span className={busy ? 'pulse' : ''} />{status}</div>
      {!team && <div className="validation error">먼저 ‘내 팀’에서 정확한 6마리 팀을 저장하세요.</div>}
      <div className="battle-layout">
        <div className="battle-inputs">
          {screenshot && <div className="capture-preview"><img src={screenshot} alt="BlueStacks 캡처" /><span>메모리에만 유지되는 확인용 프레임</span></div>}
          {vision && <div className="vision-summary"><b>NVIDIA 인식 신뢰도 {Math.round(vision.confidence * 100)}%</b><span>{vision.unknownFields.length ? `확인 필요: ${vision.unknownFields.join(', ')}` : '필수 필드 인식 완료'}</span></div>}
          {!confirmed && <button className="confirm-button" onClick={() => { setConfirmed(true); setStatus('상태 확인 완료'); }}>인식 결과를 확인했습니다</button>}
          <label className="field"><span>상대 라인업 · 쉼표 또는 줄바꿈</span><textarea rows={6} value={opponentText} onChange={(event) => { setOpponentText(event.target.value); setConfirmed(true); }} placeholder={'Charizard\nBlastoise\nVenusaur'} /></label>
          <button className="primary full" disabled={!team || busy || opponentSpecies.length < 3} onClick={runPreview}>출전 3마리와 선봉 추천</button>
          {previewRecommendation && <div className="roles">{Object.entries(previewRecommendation.roles).map(([id, role]) => <div key={id}><b>{team?.pokemon.find((pokemon) => pokemon.id === id)?.species}</b><span>{role}</span></div>)}</div>}
          <div className="turn-fields">
            <label className="field"><span>내 활성 포켓몬</span><select value={ownActiveId} onChange={(event) => setOwnActiveId(event.target.value)}>{team?.pokemon.filter((pokemon) => selectedIds.includes(pokemon.id)).map((pokemon) => <option key={pokemon.id} value={pokemon.id}>{pokemon.species || pokemon.id}</option>)}</select></label>
            <label className="field"><span>상대 활성 포켓몬</span><input list="battle-species-list" value={opponentActive} onChange={(event) => setOpponentActive(event.target.value)} /></label>
            <label className="field"><span>내 HP %</span><input type="number" min="0" max="100" value={ownHp} onChange={(event) => setOwnHp(Number(event.target.value))} /></label>
            <label className="field"><span>상대 HP %</span><input type="number" min="0" max="100" value={opponentHp} onChange={(event) => setOpponentHp(Number(event.target.value))} /></label>
          </div>
          <button className="primary full" disabled={!team || busy || !opponentActive} onClick={runTurn}>기술·교체 통합 추천</button>
        </div>
        <div className="recommendation-column">
          {turnRecommendation ? <RecommendationCard recommendation={turnRecommendation} /> : previewRecommendation ? <RecommendationCard recommendation={previewRecommendation} /> : <div className="empty-recommendation"><span>AI</span><h3>추천 대기 중</h3><p>팀 미리보기나 현재 턴 상태를 입력하면 여기에서 근거와 대안을 비교합니다.</p></div>}
        </div>
      </div>
    </section>
  );
}
