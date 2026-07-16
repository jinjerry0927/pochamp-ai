import { useEffect, useMemo, useState } from 'react';
import { detectTeamArchetypes, localizeName, type Team, type ValidationResult } from '@pochamp/engine';
import type { BootstrapData, HistoryEntry, PublicSettings } from '../../shared/contracts';
import { BattleAssistant } from './BattleAssistant';
import { emptyTeam } from './model';
import { SettingsPanel } from './SettingsPanel';
import { TeamEditor } from './TeamEditor';

type Tab = 'dashboard' | 'teams' | 'builder' | 'battle' | 'history' | 'settings';

function summarizeTeam(team: Team): { identity: string; plan: string; caution: string } {
  const archetype = detectTeamArchetypes(team.pokemon.map((pokemon) => pokemon.species))[0];
  const fastest = [...team.pokemon].sort((left, right) => right.stats.speed - left.stats.speed)[0];
  const bulkiest = [...team.pokemon].sort((left, right) => (right.stats.hp + right.stats.defense + right.stats.specialDefense) - (left.stats.hp + left.stats.defense + left.stats.specialDefense))[0];
  if (archetype) return {
    identity: `${archetype.evidence.join(' + ')} 중심의 ${archetype.name}`,
    plan: `${archetype.setters.length ? localizeName('species', archetype.setters[0]!) : archetype.evidence[0]}로 전개를 만들고, ${archetype.abusers.length ? localizeName('species', archetype.abusers[0]!) : '화력 포켓몬'}의 안전한 투입으로 주도권을 이어가세요.`,
    caution: `${localizeName('species', fastest?.species ?? '')}의 속도 압박과 ${localizeName('species', bulkiest?.species ?? '')}의 교체 내구를 함께 살리되, 핵심 전개 요원이 먼저 쓰러지는 상황을 피하세요.`,
  };
  return {
    identity: '특정 날씨·트릭룸 코어보다 상성 대응 폭을 넓힌 밸런스 팀',
    plan: `${localizeName('species', fastest?.species ?? '')}로 선공 압박을 만들고 ${localizeName('species', bulkiest?.species ?? '')}를 교체 축으로 사용하세요.`,
    caution: '명확한 전개 코어가 감지되지 않아 상대 6마리에 맞춘 선출과 교체 타이밍이 특히 중요합니다.',
  };
}

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team>(emptyTeam());
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [fatalError, setFatalError] = useState('');

  useEffect(() => {
    window.pochamp.bootstrap().then((data) => {
      setBootstrap(data); setTeams(data.teams); setHistory(data.history); setSettings(data.settings);
      if (data.teams[0]) { setSelectedTeamId(data.teams[0].id); setEditingTeam(data.teams[0]); }
    }).catch((error) => setFatalError(error instanceof Error ? error.message : String(error)));
  }, []);

  const selectedTeam = useMemo(() => teams.find((team) => team.id === selectedTeamId) ?? null, [teams, selectedTeamId]);

  const saveTeam = async () => {
    const draft = { ...editingTeam, updatedAt: new Date().toISOString() };
    const result = await window.pochamp.saveTeam(draft);
    setValidation(result.validation);
    setTeams(result.teams);
    if (result.validation.valid) {
      setSelectedTeamId(draft.id);
      setEditingTeam(result.teams.find((team) => team.id === draft.id) ?? draft);
      setTab('teams');
    }
  };

  const loadTeam = (team: Team) => {
    setSelectedTeamId(team.id);
    setEditingTeam(structuredClone(team));
    setValidation(null);
    setTab('builder');
  };

  const chooseActiveTeam = (teamId: string) => {
    setSelectedTeamId(teamId);
    const team = teams.find((entry) => entry.id === teamId);
    if (team && tab === 'builder') setEditingTeam(structuredClone(team));
  };

  const createTeam = () => {
    setEditingTeam(emptyTeam());
    setValidation(null);
    setTab('builder');
  };

  if (fatalError) return <main className="fatal"><h1>앱을 시작하지 못했습니다</h1><p>{fatalError}</p></main>;
  if (!bootstrap || !settings) return <main className="loading"><div className="spinner" /><p>엔진과 규정 데이터를 불러오는 중…</p></main>;

  const nav: Array<[Tab, string, string]> = [['dashboard', '홈', '◈'], ['teams', '내 팀', '▦'], ['builder', '팀 제작', '＋'], ['battle', '배틀', '◆'], ['history', '기록', '◷'], ['settings', '설정', '⚙']];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">PC</div><div><strong>포챔 AI</strong><span>Battle Lab</span></div></div>
        <nav>{nav.map(([id, label, icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}</nav>
        <div className="sidebar-foot"><span className="safe-dot" />친선전 전용<div>M-B · 싱글 3마리</div></div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div className="team-switcher"><span>활성 팀</span><select value={selectedTeamId} onChange={(event) => chooseActiveTeam(event.target.value)}><option value="">저장된 팀 없음</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
          <div className="runtime-badges"><span className={settings.sourceId ? 'ok' : ''}>BlueStacks</span><span className={settings.hasApiKey ? 'ok' : ''}>NVIDIA NIM</span></div>
        </header>
        {tab === 'dashboard' && <section className="page-stack dashboard">
          <div className="hero"><div><span className="eyebrow">Pokémon Champions · 개인 전략 실험</span><h1>판단은 더 빠르게.<br /><em>선택은 당신이.</em></h1><p>화면을 읽고, 상태를 확인하고, 로컬 시뮬레이터가 기술과 교체를 함께 비교합니다.</p><button className="primary large" onClick={() => setTab('battle')}>배틀 도우미 열기</button></div><div className="hero-orbit"><div className="orb"><span>AI</span></div><i /><i /><i /></div></div>
          <div className="metric-grid"><article><span>현재 규정</span><strong>{bootstrap.regulation.id}</strong><small>{bootstrap.regulation.species.length}개 종·폼 스냅샷</small></article><article><span>저장 팀</span><strong>{teams.length}</strong><small>실제 Lv.50 스탯 기준</small></article><article><span>추천 기록</span><strong>{history.length}</strong><small>최대 1,000건 로컬 보관</small></article><article><span>현재 학습 방식</span><strong className="shortcut">고정 정책</strong><small>승패 기록으로 자동 재학습하지 않음</small></article></div>
          <div className="principles"><article><b>01</b><h3>NIM은 눈</h3><p>사전 학습된 화면 AI가 사실을 구조화합니다.</p></article><article><b>02</b><h3>로컬 엔진은 두뇌</h3><p>60개 선출과 턴 행동을 규칙·근사 탐색으로 비교합니다.</p></article><article><b>03</b><h3>아직 자체 학습은 없음</h3><p>추천 기록은 저장하지만 승패로 모델 가중치를 바꾸지는 않습니다.</p></article></div>
        </section>}
        {tab === 'teams' && <section className="page-stack"><div className="section-heading"><div><span className="eyebrow">검증·저장 완료</span><h2>내 팀</h2></div><button className="primary" onClick={createTeam}>새 팀 제작</button></div>{teams.length ? <div className="team-library">{teams.map((team) => { const summary = summarizeTeam(team); return <article className={team.id === selectedTeamId ? 'team-summary-card active' : 'team-summary-card'} key={team.id}><div className="team-summary-head"><div><span>{team.id === selectedTeamId ? '활성 팀' : '저장 팀'}</span><h3>{team.name}</h3></div><small>{new Date(team.updatedAt).toLocaleDateString('ko-KR')}</small></div><div className="team-roster">{team.pokemon.map((pokemon, index) => <span key={pokemon.id}><b>{index + 1}</b>{localizeName('species', pokemon.species)}</span>)}</div><div className="ai-summary"><b>AI TEAM SUMMARY · 로컬 전략 엔진</b><strong>{summary.identity}</strong><p>{summary.plan}</p><small>주의 · {summary.caution}</small></div><div className="team-actions"><button className="primary" onClick={() => chooseActiveTeam(team.id)}>활성 팀으로 사용</button><button onClick={() => loadTeam(team)}>팀 제작에서 수정</button></div></article>; })}</div> : <div className="empty-list">검증·저장된 팀이 없습니다. ‘새 팀 제작’에서 첫 팀을 만드세요.</div>}</section>}
        {tab === 'builder' && <TeamEditor team={editingTeam} savedTeams={teams} regulation={bootstrap.regulation} validation={validation} onChange={setEditingTeam} onLoad={loadTeam} onNew={createTeam} onSave={saveTeam} />}
        {tab === 'battle' && <><datalist id="battle-species-list">{bootstrap.regulation.species.map((entry) => <option key={entry.id} value={entry.displayName}>{entry.name}</option>)}</datalist><BattleAssistant team={selectedTeam} regulation={bootstrap.regulation} onHistory={setHistory} /></>}
        {tab === 'history' && <section className="page-stack"><div className="section-heading"><div><span className="eyebrow">로컬 실험 로그</span><h2>추천 기록</h2></div></div><div className="history-list">{history.length ? history.map((entry) => <article key={entry.id}><div><b>{entry.kind === 'preview' ? '선출' : entry.kind === 'turn' ? '턴' : '경기'} · {entry.teamName}</b><span>{new Date(entry.createdAt).toLocaleString('ko-KR')}</span></div><strong>{entry.recommendation?.primaryAction.label ?? entry.result ?? '기록'}</strong><em>{entry.recommendation ? `${entry.recommendation.simulatedWinRate}%` : ''}</em></article>) : <div className="empty-list">아직 기록이 없습니다.</div>}</div></section>}
        {tab === 'settings' && <SettingsPanel settings={settings} onSettings={setSettings} />}
      </main>
    </div>
  );
}
