import { useEffect, useMemo, useState } from 'react';
import type { Team, ValidationResult } from '@pochamp/engine';
import type { BootstrapData, HistoryEntry, PublicSettings } from '../../shared/contracts';
import { BattleAssistant } from './BattleAssistant';
import { emptyTeam } from './model';
import { SettingsPanel } from './SettingsPanel';
import { TeamEditor } from './TeamEditor';

type Tab = 'dashboard' | 'team' | 'battle' | 'history' | 'settings';

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
    const result = await window.pochamp.saveTeam({ ...editingTeam, updatedAt: new Date().toISOString() });
    setValidation(result.validation);
    setTeams(result.teams);
    if (result.validation.valid) setSelectedTeamId(editingTeam.id);
  };

  if (fatalError) return <main className="fatal"><h1>앱을 시작하지 못했습니다</h1><p>{fatalError}</p></main>;
  if (!bootstrap || !settings) return <main className="loading"><div className="spinner" /><p>엔진과 규정 데이터를 불러오는 중…</p></main>;

  const nav: Array<[Tab, string, string]> = [['dashboard', '홈', '◈'], ['team', '내 팀', '▦'], ['battle', '배틀', '◆'], ['history', '기록', '◷'], ['settings', '설정', '⚙']];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">PC</div><div><strong>포챔 AI</strong><span>Battle Lab</span></div></div>
        <nav>{nav.map(([id, label, icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><span>{icon}</span>{label}</button>)}</nav>
        <div className="sidebar-foot"><span className="safe-dot" />친선전 전용<div>M-B · 싱글 3마리</div></div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div className="team-switcher"><span>활성 팀</span><select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}><option value="">저장된 팀 없음</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
          <div className="runtime-badges"><span className={settings.sourceId ? 'ok' : ''}>BlueStacks</span><span className={settings.hasApiKey ? 'ok' : ''}>NVIDIA NIM</span></div>
        </header>
        {tab === 'dashboard' && <section className="page-stack dashboard">
          <div className="hero"><div><span className="eyebrow">Pokémon Champions · 개인 전략 실험</span><h1>판단은 더 빠르게.<br /><em>선택은 당신이.</em></h1><p>화면을 읽고, 상태를 확인하고, 로컬 시뮬레이터가 기술과 교체를 함께 비교합니다.</p><button className="primary large" onClick={() => setTab('battle')}>배틀 도우미 열기</button></div><div className="hero-orbit"><div className="orb"><span>AI</span></div><i /><i /><i /></div></div>
          <div className="metric-grid"><article><span>현재 규정</span><strong>{bootstrap.regulation.id}</strong><small>{bootstrap.regulation.species.length}개 종·폼 스냅샷</small></article><article><span>저장 팀</span><strong>{teams.length}</strong><small>실제 Lv.50 스탯 기준</small></article><article><span>추천 기록</span><strong>{history.length}</strong><small>최대 1,000건 로컬 보관</small></article><article><span>전역 단축키</span><strong className="shortcut">Ctrl ⇧ Space</strong><small>단일 프레임만 캡처</small></article></div>
          <div className="principles"><article><b>01</b><h3>NIM은 눈</h3><p>화면에서 사실만 구조화합니다.</p></article><article><b>02</b><h3>엔진은 두뇌</h3><p>60개 선출과 턴 행동을 로컬에서 비교합니다.</p></article><article><b>03</b><h3>사람이 최종 확인</h3><p>오인식과 숨은 정보를 확인한 뒤 추천을 실행합니다.</p></article></div>
        </section>}
        {tab === 'team' && <TeamEditor team={editingTeam} regulation={bootstrap.regulation} validation={validation} onChange={setEditingTeam} onSave={saveTeam} />}
        {tab === 'battle' && <><datalist id="battle-species-list">{bootstrap.regulation.species.map((entry) => <option key={entry.id} value={entry.displayName}>{entry.name}</option>)}</datalist><BattleAssistant team={selectedTeam} regulation={bootstrap.regulation} onHistory={setHistory} /></>}
        {tab === 'history' && <section className="page-stack"><div className="section-heading"><div><span className="eyebrow">로컬 실험 로그</span><h2>추천 기록</h2></div></div><div className="history-list">{history.length ? history.map((entry) => <article key={entry.id}><div><b>{entry.kind === 'preview' ? '선출' : entry.kind === 'turn' ? '턴' : '경기'} · {entry.teamName}</b><span>{new Date(entry.createdAt).toLocaleString('ko-KR')}</span></div><strong>{entry.recommendation?.primaryAction.label ?? entry.result ?? '기록'}</strong><em>{entry.recommendation ? `${entry.recommendation.simulatedWinRate}%` : ''}</em></article>) : <div className="empty-list">아직 기록이 없습니다.</div>}</div></section>}
        {tab === 'settings' && <SettingsPanel settings={settings} onSettings={setSettings} />}
      </main>
    </div>
  );
}
