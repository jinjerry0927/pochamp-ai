import { z } from 'zod';

export const statBlockSchema = z.object({
  hp: z.number().int().positive(),
  attack: z.number().int().positive(),
  defense: z.number().int().positive(),
  specialAttack: z.number().int().positive(),
  specialDefense: z.number().int().positive(),
  speed: z.number().int().positive(),
});

export const trainingBlockSchema = z.object({
  hp: z.number().int().min(0).max(252).default(0),
  attack: z.number().int().min(0).max(252).default(0),
  defense: z.number().int().min(0).max(252).default(0),
  specialAttack: z.number().int().min(0).max(252).default(0),
  specialDefense: z.number().int().min(0).max(252).default(0),
  speed: z.number().int().min(0).max(252).default(0),
});

export const statPointBlockSchema = z.object({
  hp: z.number().int().min(0).max(32).default(0),
  attack: z.number().int().min(0).max(32).default(0),
  defense: z.number().int().min(0).max(32).default(0),
  specialAttack: z.number().int().min(0).max(32).default(0),
  specialDefense: z.number().int().min(0).max(32).default(0),
  speed: z.number().int().min(0).max(32).default(0),
}).refine((points) => Object.values(points).reduce((sum, value) => sum + value, 0) <= 66, {
  message: '능력 포인트는 합계 66을 넘을 수 없습니다.',
});

export const teamPokemonSchema = z.object({
  id: z.string().min(1),
  species: z.string().min(1),
  form: z.string().default(''),
  gender: z.enum(['M', 'F', 'N']).default('N'),
  ability: z.string().min(1),
  heldItem: z.string().default(''),
  moves: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
  level: z.number().int().positive().default(50),
  stats: statBlockSchema,
  statPoints: statPointBlockSchema.default({ hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 }),
  statAlignment: z.string().min(1),
  nature: z.string().optional(),
  ivs: trainingBlockSchema.optional(),
  evs: trainingBlockSchema.optional(),
  megaEligible: z.boolean().default(false),
});

export const teamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  regulationId: z.string().min(1),
  pokemon: z.array(teamPokemonSchema).length(6),
  updatedAt: z.string().datetime(),
});

export const boostsSchema = z.object({
  attack: z.number().int().min(-6).max(6).default(0),
  defense: z.number().int().min(-6).max(6).default(0),
  specialAttack: z.number().int().min(-6).max(6).default(0),
  specialDefense: z.number().int().min(-6).max(6).default(0),
  speed: z.number().int().min(-6).max(6).default(0),
  accuracy: z.number().int().min(-6).max(6).default(0),
  evasion: z.number().int().min(-6).max(6).default(0),
});

export const statusConditionSchema = z.enum(['none', 'burn', 'poison', 'toxic', 'paralysis', 'sleep', 'freeze', 'unknown']);
export const volatileStatusSchema = z.enum(['drowsy', 'confusion', 'taunt', 'encore', 'substitute', 'leech-seed']);

export const battlePokemonStateSchema = z.object({
  teamPokemonId: z.string().optional(),
  species: z.string().min(1),
  currentHp: z.number().min(0),
  maxHp: z.number().positive(),
  status: statusConditionSchema.default('none'),
  volatileStatuses: z.array(volatileStatusSchema).max(6).optional(),
  fainted: z.boolean().default(false),
  boosts: boostsSchema,
  remainingPp: z.record(z.string(), z.number().int().nonnegative()).default({}),
  revealedMoves: z.array(z.string()).max(4).default([]),
  revealedAbility: z.string().optional(),
  revealedItem: z.string().optional(),
});

export const battleStateSchema = z.object({
  phase: z.enum(['preview', 'turn', 'forced-switch', 'result']),
  turn: z.number().int().nonnegative(),
  selectedOwnIds: z.array(z.string()).max(3),
  opponentPreview: z.array(z.string()).max(6),
  ownActive: battlePokemonStateSchema.optional(),
  opponentActive: battlePokemonStateSchema.optional(),
  ownBench: z.array(battlePokemonStateSchema).max(2).default([]),
  opponentBench: z.array(battlePokemonStateSchema).max(2).default([]),
  weather: z.enum(['none', 'sun', 'rain', 'sand', 'snow', 'unknown']).default('none'),
  terrain: z.enum(['none', 'electric', 'grassy', 'misty', 'psychic', 'unknown']).default('none'),
  ownHazards: z.array(z.string()).default([]),
  opponentHazards: z.array(z.string()).default([]),
  ownMegaUsed: z.boolean().default(false),
  opponentMegaUsed: z.boolean().default(false),
  trickRoomTurns: z.number().int().min(0).max(5).default(0),
});

export const visionResultSchema = z.object({
  phase: z.enum(['preview', 'turn', 'forced-switch', 'result', 'unknown']),
  confidence: z.number().min(0).max(1),
  opponentPreview: z.array(z.string()).max(6).default([]),
  ownActiveSpecies: z.string().nullable().default(null),
  opponentActiveSpecies: z.string().nullable().default(null),
  ownHpPercent: z.number().min(0).max(100).nullable().default(null),
  opponentHpPercent: z.number().min(0).max(100).nullable().default(null),
  ownStatus: statusConditionSchema.nullable().default(null),
  opponentStatus: statusConditionSchema.nullable().default(null),
  ownVolatileStatuses: z.array(volatileStatusSchema).max(6).default([]),
  opponentVolatileStatuses: z.array(volatileStatusSchema).max(6).default([]),
  weather: z.enum(['none', 'sun', 'rain', 'sand', 'snow', 'unknown']).nullable().default(null),
  terrain: z.enum(['none', 'electric', 'grassy', 'misty', 'psychic', 'unknown']).nullable().default(null),
  trickRoomTurns: z.number().int().min(0).max(5).nullable().default(null),
  visibleMoves: z.array(z.string()).max(4).default([]),
  opponentPreviewSlots: z.array(z.object({
    slot: z.number().int().min(1).max(6),
    species: z.string().nullable().default(null),
    candidates: z.array(z.string()).max(3).default([]),
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(300).default(''),
  })).max(6).default([]),
  unknownFields: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export type StatBlock = z.infer<typeof statBlockSchema>;
export type StatPointBlock = z.infer<typeof statPointBlockSchema>;
export type TeamPokemon = z.infer<typeof teamPokemonSchema>;
export type Team = z.infer<typeof teamSchema>;
export type BattlePokemonState = z.infer<typeof battlePokemonStateSchema>;
export type BattleState = z.infer<typeof battleStateSchema>;
export type VisionResult = z.infer<typeof visionResultSchema>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ActionEvaluation {
  kind: 'move' | 'switch';
  id: string;
  label: string;
  simulatedWinRate: number;
  score: number;
  outcome: { favorable: number; neutral: number; unfavorable: number };
  reasons: string[];
  risks: string[];
  pivotTargetPokemonId?: string;
}

export interface Recommendation {
  phase: 'preview' | 'turn' | 'forced-switch';
  primaryAction: ActionEvaluation;
  alternatives: ActionEvaluation[];
  simulatedWinRate: number;
  confidence: 'high' | 'medium' | 'low';
  assumptions: string[];
  latencyMs: number;
  stateVersion: string;
}

export interface PreviewRecommendation extends Recommendation {
  phase: 'preview';
  selectedPokemonIds: string[];
  leadPokemonId: string;
  roles: Record<string, string>;
}

export interface PreviewInput {
  team: Team;
  opponentSpecies: string[];
}

export interface TurnInput {
  team: Team;
  state: BattleState;
  rolloutCount?: number;
}
