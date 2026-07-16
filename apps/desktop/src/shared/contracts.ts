import type { BattleState, PreviewInput, PreviewRecommendation, Recommendation, StatBlock, Team, TurnInput, ValidationResult, VisionResult } from '@pochamp/engine';

export interface CropRect { x: number; y: number; width: number; height: number }

export interface PublicSettings {
  sourceId: string;
  crop: CropRect;
  model: string;
  hasApiKey: boolean;
  consentAccepted: boolean;
  alwaysOnTop: boolean;
  updateFeedUrl: string;
}

export type UpdatePhase = 'not-configured' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  message: string;
}

export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
}

export interface LocalVisionCandidate {
  species: string;
  confidence: number;
  types: string[];
  source: 'seed' | 'learned';
}

export interface LocalVisionSlot {
  slot: number;
  imageDataUrl: string;
  candidates: LocalVisionCandidate[];
}

export interface VisionReferenceStatus {
  totalSpecies: number;
  seededSpecies: number;
  learnedSpecies: number;
  referenceCount: number;
  missingSpecies: number;
  seedCurrent: boolean;
}

export interface VisionTrainingSample {
  slot: number;
  species: string;
  imageDataUrl: string;
}

export interface CaptureAnalysis {
  duplicate: boolean;
  screenshot?: string;
  vision?: VisionResult;
  localVisionSlots?: LocalVisionSlot[];
  warning?: string;
  latencyMs: number;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  kind: 'preview' | 'turn' | 'match';
  teamName: string;
  opponent: string[];
  recommendation?: PreviewRecommendation | Recommendation;
  accepted?: boolean;
  actualAction?: string;
  result?: 'win' | 'loss' | 'unknown';
}

export interface BootstrapData {
  settings: PublicSettings;
  teams: Team[];
  history: HistoryEntry[];
  regulation: {
    id: string;
    activeUntil: string;
    species: Array<{
      id: string;
      name: string;
      displayName: string;
      nationalDex: number;
      supported: boolean;
      baseStats: StatBlock;
      abilities: string[];
      moves: string[];
      megaEligible: boolean;
      usage: {
        rank: number | null;
        moves: Array<{ name: string; usage: number }>;
        abilities: Array<{ name: string; usage: number }>;
        items: Array<{ name: string; usage: number }>;
        statAlignments: Array<{ name: string; usage: number }>;
      };
    }>;
    allowedMegas: readonly string[];
    items: string[];
    statAlignments: Array<{
      id: string;
      raised: string | null;
      lowered: string | null;
      raisedStat: keyof StatBlock | null;
      loweredStat: keyof StatBlock | null;
    }>;
    localization: {
      checkedAt: string;
      source: string;
      species: Record<string, string>;
      moves: Record<string, string>;
      abilities: Record<string, string>;
      items: Record<string, string>;
      natures: Record<string, string>;
    };
    meta: {
      checkedAt: string;
      source: string;
      format: string;
      limitation: string;
    };
  };
}

export interface PochampApi {
  bootstrap(): Promise<BootstrapData>;
  listCaptureSources(): Promise<CaptureSource[]>;
  updateSettings(settings: Partial<Omit<PublicSettings, 'hasApiKey'>>): Promise<PublicSettings>;
  setApiKey(apiKey: string): Promise<PublicSettings>;
  clearApiKey(): Promise<PublicSettings>;
  analyzeCapture(): Promise<CaptureAnalysis>;
  getVisionReferenceStatus(): Promise<VisionReferenceStatus>;
  seedVisionReferences(): Promise<VisionReferenceStatus>;
  learnVisionReferences(samples: VisionTrainingSample[]): Promise<VisionReferenceStatus>;
  saveTeam(team: Team): Promise<{ validation: ValidationResult; teams: Team[] }>;
  deleteTeam(teamId: string): Promise<Team[]>;
  validateTeam(team: Team): Promise<ValidationResult>;
  recommendPreview(input: PreviewInput): Promise<PreviewRecommendation>;
  recommendTurn(input: TurnInput): Promise<Recommendation>;
  searchDex(kind: 'species' | 'move' | 'ability' | 'item', query?: string, limit?: number): Promise<string[]>;
  addHistory(entry: HistoryEntry): Promise<HistoryEntry[]>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  onCaptureHotkey(callback: () => void): () => void;
}

export type { BattleState, PreviewInput, PreviewRecommendation, Recommendation, Team, TurnInput, ValidationResult, VisionResult };
