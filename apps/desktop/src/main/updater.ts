import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateState } from '../shared/contracts.js';

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15_000;

export class UpdateManager {
  private state: UpdateState = {
    phase: 'not-configured',
    currentVersion: app.getVersion(),
    message: '업데이트 서버가 연결되지 않았습니다.',
  };
  private feedUrl = '';
  private startupTimer?: ReturnType<typeof setTimeout>;
  private intervalTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => this.setState({ phase: 'checking', message: '새 버전을 확인하고 있습니다.' }));
    autoUpdater.on('update-available', (info) => this.setState({
      phase: 'available',
      availableVersion: info.version,
      message: `${info.version} 버전을 사용할 수 있습니다.`,
    }));
    autoUpdater.on('update-not-available', () => this.setState({
      phase: 'up-to-date',
      availableVersion: undefined,
      percent: undefined,
      message: '현재 최신 버전입니다.',
    }));
    autoUpdater.on('download-progress', (progress) => this.setState({
      phase: 'downloading',
      percent: Math.round(progress.percent),
      message: `업데이트를 다운로드하고 있습니다. ${Math.round(progress.percent)}%`,
    }));
    autoUpdater.on('update-downloaded', (info) => this.setState({
      phase: 'downloaded',
      availableVersion: info.version,
      percent: 100,
      message: '다운로드가 끝났습니다. 재시작하면 업데이트가 설치됩니다.',
    }));
    autoUpdater.on('error', (error) => this.setState({
      phase: 'error',
      message: `업데이트 확인에 실패했습니다: ${error.message}`,
    }));
  }

  configure(value: string): UpdateState {
    this.stopSchedule();
    this.feedUrl = '';
    const trimmed = value.trim();
    if (!trimmed) {
      return this.setState({ phase: 'not-configured', availableVersion: undefined, percent: undefined, message: '업데이트 서버가 연결되지 않았습니다.' });
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return this.setState({ phase: 'error', message: '업데이트 서버 주소 형식이 올바르지 않습니다.' });
    }
    if (url.protocol !== 'https:') return this.setState({ phase: 'error', message: '업데이트 서버는 HTTPS 주소만 사용할 수 있습니다.' });
    this.feedUrl = url.toString();
    autoUpdater.setFeedURL({ provider: 'generic', url: this.feedUrl });
    this.setState({ phase: 'idle', availableVersion: undefined, percent: undefined, message: '자동 업데이트 확인이 켜졌습니다.' });

    if (app.isPackaged) {
      this.startupTimer = setTimeout(() => void this.check(), STARTUP_DELAY_MS);
      this.intervalTimer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    }
    return this.getState();
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  async check(): Promise<UpdateState> {
    if (!this.feedUrl) return this.getState();
    if (!app.isPackaged) return this.setState({ phase: 'idle', message: '개발 모드에서는 설치 파일의 업데이트만 확인할 수 있습니다.' });
    await autoUpdater.checkForUpdates();
    return this.getState();
  }

  async download(): Promise<UpdateState> {
    if (this.state.phase !== 'available') throw new Error('다운로드할 새 버전이 없습니다. 먼저 업데이트를 확인하세요.');
    await autoUpdater.downloadUpdate();
    return this.getState();
  }

  install(): void {
    if (this.state.phase !== 'downloaded') throw new Error('설치할 업데이트가 아직 다운로드되지 않았습니다.');
    autoUpdater.quitAndInstall(false, true);
  }

  dispose(): void {
    this.stopSchedule();
  }

  private stopSchedule(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = undefined;
    this.intervalTimer = undefined;
  }

  private setState(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch, currentVersion: app.getVersion() };
    this.getWindow()?.webContents.send('update:state', this.state);
    return this.getState();
  }
}
