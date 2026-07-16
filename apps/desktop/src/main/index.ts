import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, session } from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { battleStateSchema, getSpeciesBuilderOptions, recommendPreview, recommendTurn, regulationItems, regulationMB, regulationSpecies, searchDex, statAlignmentOptions, teamSchema, validateTeam, type Team } from '@pochamp/engine';
import { z } from 'zod';
import { AppStore } from './store.js';
import { analyzeWithNim } from './nim.js';
import type { CaptureAnalysis, CropRect, HistoryEntry } from '../shared/contracts.js';
import { UpdateManager } from './updater.js';

let mainWindow: BrowserWindow | null = null;
let lastCaptureHash = '';
let store: AppStore;
let updateManager: UpdateManager;

app.enableSandbox();

const cropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
}).strict();
const httpsUrlOrEmptySchema = z.string().trim().max(2048).refine((value) => {
  if (!value) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}, 'HTTPS 업데이트 서버 주소를 입력하세요.');
const settingsPatchSchema = z.object({
  sourceId: z.string().max(512),
  crop: cropSchema,
  model: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9._/-]+$/),
  consentAccepted: z.boolean(),
  alwaysOnTop: z.boolean(),
  updateFeedUrl: httpsUrlOrEmptySchema,
}).partial().strict();
const shortIdSchema = z.string().min(1).max(256);
const previewInputSchema = z.object({
  team: teamSchema,
  opponentSpecies: z.array(z.string().min(1).max(100)).min(3).max(6),
}).strict();
const turnInputSchema = z.object({
  team: teamSchema,
  state: battleStateSchema,
  rolloutCount: z.number().int().min(1).max(512).optional(),
}).strict();
const historyEntrySchema = z.object({
  id: shortIdSchema,
  createdAt: z.string().datetime(),
  kind: z.enum(['preview', 'turn', 'match']),
  teamName: z.string().max(200),
  opponent: z.array(z.string().max(100)).max(6),
  recommendation: z.unknown().optional(),
  accepted: z.boolean().optional(),
  actualAction: z.string().max(500).optional(),
  result: z.enum(['win', 'loss', 'unknown']).optional(),
}).strict();

function handle<T extends unknown[], R>(channel: string, listener: (...args: T) => R): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('신뢰할 수 없는 화면에서 보낸 요청을 차단했습니다.');
    }
    return listener(...args as T);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: false,
    backgroundColor: '#09111f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: is.dev,
    },
  });
  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (is.dev && process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function normalizedCrop(size: Electron.Size, crop: CropRect): Electron.Rectangle {
  const x = Math.max(0, Math.min(size.width - 1, Math.floor(crop.x * size.width)));
  const y = Math.max(0, Math.min(size.height - 1, Math.floor(crop.y * size.height)));
  const width = Math.max(1, Math.min(size.width - x, Math.floor(crop.width * size.width)));
  const height = Math.max(1, Math.min(size.height - y, Math.floor(crop.height * size.height)));
  return { x, y, width, height };
}

async function captureSelectedSource(): Promise<{ duplicate: boolean; dataUrl?: string }> {
  const settings = await store.getStoredSettings();
  if (!settings.sourceId) throw new Error('설정에서 BlueStacks 창을 먼저 선택하세요.');
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false });
  const source = sources.find((entry) => entry.id === settings.sourceId);
  if (!source || source.thumbnail.isEmpty()) throw new Error('선택한 BlueStacks 창을 찾지 못했습니다. 창 목록을 새로고침하세요.');
  const cropped = source.thumbnail.crop(normalizedCrop(source.thumbnail.getSize(), settings.crop));
  const resized = cropped.getSize().width > 1440 ? cropped.resize({ width: 1440, quality: 'good' }) : cropped;
  const png = resized.toPNG();
  const hash = createHash('sha256').update(png).digest('hex');
  if (hash === lastCaptureHash) return { duplicate: true };
  lastCaptureHash = hash;
  return { duplicate: false, dataUrl: nativeImage.createFromBuffer(png).toDataURL() };
}

function registerIpc(): void {
  handle('app:bootstrap', async () => ({
    settings: await store.getPublicSettings(),
    teams: await store.listTeams(),
    history: await store.listHistory(),
    regulation: {
      id: regulationMB.id,
      activeUntil: regulationMB.activeUntil,
      species: regulationSpecies().map((entry) => ({ ...entry, ...getSpeciesBuilderOptions(entry.name) })),
      allowedMegas: regulationMB.allowedMegas,
      items: regulationItems(),
      statAlignments: statAlignmentOptions,
    },
  }));

  handle('capture:list-sources', async () => (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 } })).map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  })));

  handle('settings:update', async (input: unknown) => {
    const patch = settingsPatchSchema.parse(input);
    const settings = await store.updateSettings(patch);
    if (typeof patch.alwaysOnTop === 'boolean') mainWindow?.setAlwaysOnTop(patch.alwaysOnTop);
    if (typeof patch.updateFeedUrl === 'string') updateManager.configure(settings.updateFeedUrl);
    return settings;
  });
  handle('secret:set-api-key', (input: unknown) => store.setApiKey(z.string().trim().min(1).max(512).parse(input)));
  handle('secret:clear-api-key', () => store.clearApiKey());

  handle('capture:analyze', async (): Promise<CaptureAnalysis> => {
    const started = performance.now();
    const settings = await store.getStoredSettings();
    if (!settings.consentAccepted) throw new Error('설정에서 NVIDIA 화면 전송 고지에 먼저 동의하세요.');
    const capture = await captureSelectedSource();
    if (capture.duplicate) return { duplicate: true, latencyMs: Math.round(performance.now() - started), warning: '직전 프레임과 같아 API 호출을 생략했습니다.' };
    const apiKey = await store.getApiKey();
    if (!apiKey) return { duplicate: false, screenshot: capture.dataUrl, latencyMs: Math.round(performance.now() - started), warning: 'API 키가 없어 수동 입력 모드로 전환했습니다.' };
    try {
      const vision = await analyzeWithNim({ apiKey, model: settings.model, imageDataUrl: capture.dataUrl!, allowedSpecies: regulationSpecies().map((entry) => entry.name) });
      return { duplicate: false, vision, latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return { duplicate: false, screenshot: capture.dataUrl, latencyMs: Math.round(performance.now() - started), warning: `화면 인식 실패: ${error instanceof Error ? error.message : String(error)}. 수동 입력을 사용하세요.` };
    }
  });

  handle('team:validate', (team: unknown) => validateTeam(team));
  handle('team:save', async (input: unknown) => {
    const team = teamSchema.parse(input) as Team;
    const validation = validateTeam(team);
    if (!validation.valid) return { validation, teams: await store.listTeams() };
    return { validation, teams: await store.saveTeam(team) };
  });
  handle('team:delete', (teamId: unknown) => store.deleteTeam(shortIdSchema.parse(teamId)));
  handle('dex:search', (kind: unknown, query: unknown, limit: unknown) => searchDex(
    z.enum(['species', 'move', 'ability', 'item']).parse(kind),
    z.string().max(100).optional().parse(query),
    z.number().int().min(1).max(500).optional().parse(limit),
  ));
  handle('recommend:preview', (input: unknown) => recommendPreview(previewInputSchema.parse(input)));
  handle('recommend:turn', (input: unknown) => recommendTurn(turnInputSchema.parse(input)));
  handle('history:add', (input: unknown) => store.addHistory(historyEntrySchema.parse(input) as HistoryEntry));
  handle('update:get-state', () => updateManager.getState());
  handle('update:check', () => updateManager.check());
  handle('update:download', () => updateManager.download());
  handle('update:install', () => updateManager.install());
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('local.pochamp.ai');
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window));
  store = new AppStore();
  updateManager = new UpdateManager(() => mainWindow);
  registerIpc();
  createWindow();
  const settings = await store.getPublicSettings();
  mainWindow?.setAlwaysOnTop(settings.alwaysOnTop);
  updateManager.configure(settings.updateFeedUrl);
  globalShortcut.register('CommandOrControl+Shift+Space', () => mainWindow?.webContents.send('hotkey:capture'));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); updateManager?.dispose(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
