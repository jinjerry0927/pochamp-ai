import { useEffect, useState } from 'react';
import type { CaptureSource, PublicSettings, UpdateState } from '../../shared/contracts';

interface Props { settings: PublicSettings; onSettings(settings: PublicSettings): void }

export function SettingsPanel({ settings, onSettings }: Props) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [updateFeedUrl, setUpdateFeedUrl] = useState(settings.updateFeedUrl);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  const refresh = async () => setSources(await window.pochamp.listCaptureSources());
  useEffect(() => {
    void refresh();
    void window.pochamp.getUpdateState().then(setUpdateState);
    return window.pochamp.onUpdateState(setUpdateState);
  }, []);
  useEffect(() => setUpdateFeedUrl(settings.updateFeedUrl), [settings.updateFeedUrl]);

  const update = async (patch: Partial<Omit<PublicSettings, 'hasApiKey'>>) => {
    try { onSettings(await window.pochamp.updateSettings(patch)); setMessage('설정을 저장했습니다.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const cropField = (key: keyof PublicSettings['crop'], label: string) => <label className="field compact"><span>{label}</span><input type="number" min="0" max="1" step="0.01" value={settings.crop[key]} onChange={(event) => void update({ crop: { ...settings.crop, [key]: Number(event.target.value) } })} /></label>;
  const runUpdate = async (action: 'check' | 'download' | 'install') => {
    try {
      if (action === 'check') setUpdateState(await window.pochamp.checkForUpdates());
      if (action === 'download') setUpdateState(await window.pochamp.downloadUpdate());
      if (action === 'install') await window.pochamp.installUpdate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="page-stack">
      <div className="section-heading"><div><span className="eyebrow">로컬·비밀키 설정</span><h2>연결 및 캡처</h2></div><button onClick={refresh}>창 목록 새로고침</button></div>
      {message && <div className="status-line"><span />{message}</div>}
      <article className="settings-card">
        <h3>1. BlueStacks 창</h3>
        <label className="field"><span>캡처할 창</span><select value={settings.sourceId} onChange={(event) => void update({ sourceId: event.target.value })}><option value="">창을 선택하세요</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label>
        <div className="source-grid">{sources.filter((source) => /blue|app player/i.test(source.name)).map((source) => <button className={source.id === settings.sourceId ? 'source selected' : 'source'} key={source.id} onClick={() => void update({ sourceId: source.id })}><img src={source.thumbnail} alt="" /><span>{source.name}</span></button>)}</div>
        <h4>정규화 캡처 영역</h4>
        <div className="stats-grid">{cropField('x', 'X')}{cropField('y', 'Y')}{cropField('width', '너비')}{cropField('height', '높이')}</div>
      </article>
      <article className="settings-card">
        <h3>2. NVIDIA NIM</h3>
        <div className="notice">캡처 원본은 NVIDIA 호스팅 API로 전송되며 디스크에는 저장하지 않습니다. 배틀 도우미에서 ‘이미지 학습’을 직접 누른 경우에만 상대 아이콘 슬롯 6개를 로컬 참조 데이터로 저장합니다.</div>
        <label className="check consent"><input type="checkbox" checked={settings.consentAccepted} onChange={(event) => void update({ consentAccepted: event.target.checked })} />화면 전송 사실을 확인했고 개인 친선전에서만 사용합니다.</label>
        <label className="field"><span>모델 ID</span><input value={settings.model} onChange={(event) => void update({ model: event.target.value })} /></label>
        <div className="api-row"><label className="field"><span>NVIDIA API 키</span><input type="password" value={apiKey} placeholder={settings.hasApiKey ? '보안 저장소에 등록됨' : 'nvapi-…'} onChange={(event) => setApiKey(event.target.value)} /></label><button className="primary" onClick={async () => { try { onSettings(await window.pochamp.setApiKey(apiKey)); setApiKey(''); setMessage('API 키를 Windows 보안 저장소에 저장했습니다.'); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>키 저장</button><button onClick={async () => onSettings(await window.pochamp.clearApiKey())}>삭제</button></div>
        <div className="notice">앱 창은 일반 창으로 동작합니다. Chrome이나 다른 프로그램을 누르면 포챔 AI는 그 창 뒤로 이동합니다.</div>
      </article>
      <article className="settings-card">
        <h3>3. 앱 업데이트</h3>
        <div className="notice">HTTPS 업데이트 서버를 연결하면 앱이 시작된 뒤 자동으로 새 버전을 확인합니다. 새 버전은 이 화면에서 다운로드하고 재시작하여 설치할 수 있습니다.</div>
        <label className="field"><span>업데이트 서버 주소</span><input type="url" value={updateFeedUrl} placeholder="https://updates.example.com/pochamp-ai/" onChange={(event) => setUpdateFeedUrl(event.target.value)} onBlur={() => { if (updateFeedUrl !== settings.updateFeedUrl) void update({ updateFeedUrl }); }} /></label>
        <div className="update-row">
          <div><b>현재 버전 {updateState?.currentVersion ?? '확인 중'}</b><span>{updateState?.message ?? '업데이트 상태를 불러오는 중입니다.'}</span></div>
          <button disabled={!settings.updateFeedUrl || updateState?.phase === 'checking' || updateState?.phase === 'downloading'} onClick={() => void runUpdate('check')}>업데이트 확인</button>
          {updateState?.phase === 'available' && <button className="primary" onClick={() => void runUpdate('download')}>앱에서 다운로드</button>}
          {updateState?.phase === 'downloaded' && <button className="primary" onClick={() => void runUpdate('install')}>재시작 및 설치</button>}
        </div>
        {updateState?.phase === 'downloading' && <progress value={updateState.percent ?? 0} max="100" />}
        <small className="security-note">신뢰할 수 있는 배포자가 제공한 HTTPS 주소만 입력하세요. 공개 배포 전에는 Windows 코드 서명 적용이 필요합니다.</small>
      </article>
    </section>
  );
}
