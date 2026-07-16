import { contextBridge, ipcRenderer } from 'electron';
import type { PochampApi } from '../shared/contracts.js';

const api: PochampApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  listCaptureSources: () => ipcRenderer.invoke('capture:list-sources'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  setApiKey: (apiKey) => ipcRenderer.invoke('secret:set-api-key', apiKey),
  clearApiKey: () => ipcRenderer.invoke('secret:clear-api-key'),
  analyzeCapture: () => ipcRenderer.invoke('capture:analyze'),
  getVisionReferenceStatus: () => ipcRenderer.invoke('vision-reference:status'),
  seedVisionReferences: () => ipcRenderer.invoke('vision-reference:seed'),
  learnVisionReferences: (samples) => ipcRenderer.invoke('vision-reference:learn', samples),
  saveTeam: (team) => ipcRenderer.invoke('team:save', team),
  deleteTeam: (teamId) => ipcRenderer.invoke('team:delete', teamId),
  validateTeam: (team) => ipcRenderer.invoke('team:validate', team),
  recommendPreview: (input) => ipcRenderer.invoke('recommend:preview', input),
  recommendTurn: (input) => ipcRenderer.invoke('recommend:turn', input),
  searchDex: (kind, query, limit) => ipcRenderer.invoke('dex:search', kind, query, limit),
  addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  onCaptureHotkey: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('hotkey:capture', listener);
    return () => ipcRenderer.removeListener('hotkey:capture', listener);
  },
};

contextBridge.exposeInMainWorld('pochamp', api);
