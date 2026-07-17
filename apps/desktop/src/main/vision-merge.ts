import type { VisionResult } from '@pochamp/engine';
import type { LocalVisionSlot } from '../shared/contracts.js';

export function visionFromConfirmedLocalSlots(localSlots: LocalVisionSlot[]): VisionResult | null {
  const resolved = Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    const local = localSlots.find((entry) => entry.slot === slot);
    const best = local?.candidates[0];
    if (!best || best.source !== 'learned' || best.confidence < 0.9) return null;
    return {
      slot,
      species: best.species,
      candidates: local.candidates.slice(1).map((candidate) => candidate.species),
      confidence: best.confidence,
      evidence: '현재 크롭 규격의 Champions 학습 이미지와 고신뢰도 일치',
    };
  });
  if (resolved.some((slot) => !slot)) return null;
  const slots = resolved.filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
  if (new Set(slots.map((slot) => slot.species)).size !== slots.length) return null;
  return {
    phase: 'preview',
    confidence: Math.min(...slots.map((slot) => slot.confidence)),
    opponentPreview: slots.map((slot) => slot.species),
    opponentPreviewSlots: slots,
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
    unknownFields: [],
    notes: ['확정 학습본 6개가 일치해 원격 화면 분석을 생략했습니다.'],
  };
}

export function mergeLocalCandidates(vision: VisionResult, localSlots: LocalVisionSlot[]): VisionResult {
  const slots = Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    const recognized = vision.opponentPreviewSlots.find((entry) => entry.slot === slot);
    const local = localSlots.find((entry) => entry.slot === slot);
    if (!recognized && !local) return null;
    const bestLocal = local?.candidates[0];
    const preferLearned = Boolean(bestLocal
      && bestLocal.source === 'learned'
      && bestLocal.confidence >= 0.9
      && bestLocal.species !== recognized?.species);
    const agreedCandidate = Boolean(bestLocal
      && !recognized?.species
      && recognized?.candidates[0] === bestLocal.species);
    const species = preferLearned
      ? bestLocal?.species ?? null
      : recognized?.species ?? (agreedCandidate ? bestLocal?.species ?? null : null);
    const candidates = [...new Set([
      ...(recognized?.species ? [recognized.species] : []),
      ...(recognized?.candidates ?? []),
      ...(local?.candidates.map((candidate) => candidate.species) ?? []),
    ])].filter((candidate) => candidate !== species).slice(0, 3);
    return {
      slot,
      species,
      candidates,
      confidence: preferLearned ? bestLocal?.confidence ?? 0 : Math.max(recognized?.confidence ?? 0, (bestLocal?.confidence ?? 0) * 0.85),
      evidence: preferLearned
        ? '현재 크롭 규격의 Champions 학습 이미지와 고신뢰도 일치'
        : recognized?.evidence || (bestLocal ? `로컬 이미지 대조 ${bestLocal.source === 'learned' ? 'Champions 학습본' : '공식 다중 렌더 참조'}` : ''),
    };
  }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const opponentPreview = [...new Set(slots
    .map((slot) => slot.species)
    .filter((species): species is string => Boolean(species)))].slice(0, 6);
  return {
    ...vision,
    opponentPreview: opponentPreview.length ? opponentPreview : vision.opponentPreview,
    opponentPreviewSlots: slots,
  };
}
