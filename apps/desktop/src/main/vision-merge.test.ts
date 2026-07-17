import { describe, expect, it } from 'vitest';
import type { VisionResult } from '@pochamp/engine';
import type { LocalVisionSlot } from '../shared/contracts.js';
import { mergeLocalCandidates, visionFromConfirmedLocalSlots } from './vision-merge.js';

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

const localSlot = (species: string, confidence: number, source: 'seed' | 'learned', slot = 1): LocalVisionSlot => ({
  slot,
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

describe('확정 학습본의 로컬 미리보기', () => {
  it('6개 슬롯이 모두 확정 학습본과 일치하면 원격 분석 없이 미리보기를 만든다', () => {
    const localSlots = Array.from({ length: 6 }, (_, index) => localSlot(`Species-${index + 1}`, 0.99, 'learned', index + 1));
    const resolved = visionFromConfirmedLocalSlots(localSlots);
    expect(resolved?.opponentPreview).toEqual(localSlots.map((slot) => slot.candidates[0]?.species));
    expect(resolved?.confidence).toBe(0.99);
    expect(resolved?.opponentPreviewSlots).toHaveLength(6);
  });

  it('초기 참조 슬롯이 하나라도 있으면 원격 교차확인을 유지한다', () => {
    const localSlots = Array.from({ length: 6 }, (_, index) => localSlot(`Species-${index + 1}`, 0.99, 'learned', index + 1));
    localSlots[5] = localSlot('Species-6', 0.99, 'seed', 6);
    expect(visionFromConfirmedLocalSlots(localSlots)).toBeNull();
  });

  it('같은 종이 여러 슬롯에 중복 매칭되면 확정으로 처리하지 않는다', () => {
    const localSlots = Array.from({ length: 6 }, (_, index) => localSlot('Aegislash', 0.99, 'learned', index + 1));
    expect(visionFromConfirmedLocalSlots(localSlots)).toBeNull();
  });
});
