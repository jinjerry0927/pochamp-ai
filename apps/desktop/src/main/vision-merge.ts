import type { VisionResult } from '@pochamp/engine';
import type { LocalVisionSlot } from '../shared/contracts.js';

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
    const species = preferLearned ? bestLocal?.species ?? null : recognized?.species ?? null;
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
        : recognized?.evidence || (bestLocal ? `로컬 이미지 대조 ${bestLocal.source === 'learned' ? 'Champions 학습본' : '초기 아이콘'}` : ''),
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
