import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Team } from '@pochamp/engine';
import type { HistoryEntry, PublicSettings } from '../shared/contracts.js';

interface StoredSettings extends Omit<PublicSettings, 'hasApiKey'> {
  schemaVersion: number;
  encryptedApiKey?: string;
}

const SETTINGS_SCHEMA_VERSION = 3;
const defaults: StoredSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  sourceId: '',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  consentAccepted: false,
  alwaysOnTop: false,
  updateFeedUrl: '',
};

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export class AppStore {
  private readonly settingsPath = join(app.getPath('userData'), 'settings.json');
  private readonly teamsPath = join(app.getPath('userData'), 'teams.json');
  private readonly historyPath = join(app.getPath('userData'), 'history.json');

  async getStoredSettings(): Promise<StoredSettings> {
    const saved = await readJson<Partial<StoredSettings>>(this.settingsPath, {});
    const settings = { ...defaults, ...saved };
    if (saved.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
      settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
      if (!saved.schemaVersion) settings.alwaysOnTop = false;
      await writeJson(this.settingsPath, settings);
    }
    return settings;
  }

  async getPublicSettings(): Promise<PublicSettings> {
    const settings = await this.getStoredSettings();
    const { encryptedApiKey, schemaVersion: _schemaVersion, ...publicSettings } = settings;
    return {
      ...publicSettings,
      updateFeedUrl: publicSettings.updateFeedUrl || process.env.POCHAMP_UPDATE_URL || '',
      hasApiKey: Boolean(encryptedApiKey || process.env.NVIDIA_API_KEY),
    };
  }

  async updateSettings(patch: Partial<Omit<PublicSettings, 'hasApiKey'>>): Promise<PublicSettings> {
    const current = await this.getStoredSettings();
    await writeJson(this.settingsPath, { ...current, ...patch });
    return this.getPublicSettings();
  }

  async setApiKey(apiKey: string): Promise<PublicSettings> {
    if (!apiKey.trim()) throw new Error('NVIDIA API 키가 비어 있습니다.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 보안 저장소를 사용할 수 없습니다. 환경 변수 NVIDIA_API_KEY를 사용하세요.');
    const current = await this.getStoredSettings();
    await writeJson(this.settingsPath, { ...current, encryptedApiKey: safeStorage.encryptString(apiKey.trim()).toString('base64') });
    return this.getPublicSettings();
  }

  async clearApiKey(): Promise<PublicSettings> {
    const current = await this.getStoredSettings();
    delete current.encryptedApiKey;
    await writeJson(this.settingsPath, current);
    return this.getPublicSettings();
  }

  async getApiKey(): Promise<string | null> {
    if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY;
    const settings = await this.getStoredSettings();
    if (!settings.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'));
    } catch {
      return null;
    }
  }

  async listTeams(): Promise<Team[]> {
    const teams = await readJson<Team[]>(this.teamsPath, []);
    return teams.map((team) => ({
      ...team,
      pokemon: team.pokemon.map((pokemon) => ({
        ...pokemon,
        statAlignment: pokemon.statAlignment === 'neutral' ? pokemon.nature || 'Serious' : pokemon.statAlignment,
        nature: undefined,
      })),
    }));
  }

  async saveTeam(team: Team): Promise<Team[]> {
    const teams = await this.listTeams();
    const index = teams.findIndex((entry) => entry.id === team.id);
    if (index >= 0) teams[index] = team;
    else teams.push(team);
    await writeJson(this.teamsPath, teams);
    return teams;
  }

  async deleteTeam(teamId: string): Promise<Team[]> {
    const teams = (await this.listTeams()).filter((team) => team.id !== teamId);
    await writeJson(this.teamsPath, teams);
    return teams;
  }

  listHistory(): Promise<HistoryEntry[]> { return readJson<HistoryEntry[]>(this.historyPath, []); }

  async addHistory(entry: HistoryEntry): Promise<HistoryEntry[]> {
    const history = [entry, ...(await this.listHistory())].slice(0, 1000);
    await writeJson(this.historyPath, history);
    return history;
  }
}
