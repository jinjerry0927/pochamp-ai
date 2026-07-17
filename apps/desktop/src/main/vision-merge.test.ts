import { describe, expect, it } from 'vitest';
import type { VisionResult } from '@pochamp/engine';
import type { LocalVisionSlot } from '../shared/contracts.js';
import { mergeLocalCandidates } from './vision-merge.js';

const vision = (slotSpecies: string | null, confidence = 0.78): VisionResult => ({
  phase: 'preview',
  confidence,
  opponentPreview: slotSpecies ? [slotSpecies] : [],
  ownActiveSpecies: null,
  opponentActiveSpecies: null,
  ownHpPercent: null,
  opponentHpPercent: null,
  ownStatus: null,
  opponentStatus: null,
  ownVolatileStatuses: [],
  opponentVolatileStatuses: [],
  weather: null,
  terrain: null,
  trickRoomTurns: null,
  visibleMoves: [],
  opponentPreviewSlots: [{ slot: 1, species: slotSpecies, candidates: ['Kingambit'], confidence, evidence: 'NIM 외형 추정' }],
  unknownFields: [],
  notes: [],
});

const localSlot = (species: string, confidence: number, source: 'seed' | 'learned'): LocalVisionSlot => ({
  slot: 1,
  imageDataUrl: 'data:image/png;base64,AA==',
  candidates: [{ species, confidence, types: ['Steel', 'Ghost'], source }],
});

describe('NIM과 로컬 이미지 후보 병합', () => {
  it('현재 규격의 고신뢰도 Champions 학습본은 충돌하는 NIM 추정을 교정한다', () => {
    const merged = mergeLocalCandidates(vision('Gholdengo'), [localSlot('Aegislash', 0.99, 'learned')]);
    expect(merged.opponentPreview).toEqual(['Aegislash']);
    expect(merged.opponentPreviewSlots[0]).toMatchObject({
      species: 'Aegislash',
      confidence: 0.99,
      candidates: ['Gholdengo', 'Kingambit'],
      evidence: '현재 크롭 규격의 Champions 학습 이미지와 고신뢰도 일치',
    });
  });

  it('기본 아이콘 후보는 NIM 확정값을 덮어쓰지 않는다', () => {
    const merged = mergeLocalCandidates(vision('Gholdengo'), [localSlot('Aegislash', 0.99, 'seed')]);
    expect(merged.opponentPreview).toEqual(['Gholdengo']);
    expect(merged.opponentPreviewSlots[0]).toMatchObject({
      species: 'Gholdengo',
      confidence: 0.8415,
      candidates: ['Kingambit', 'Aegislash'],
    });
  });

  it('NIM이 슬롯을 비워도 고신뢰도 학습본은 종을 채운다', () => {
    const merged = mergeLocalCandidates(vision(null, 0.2), [localSlot('Aegislash', 0.95, 'learned')]);
    expect(merged.opponentPreview).toEqual(['Aegislash']);
    expect(merged.opponentPreviewSlots[0]?.species).toBe('Aegislash');
  });
});
