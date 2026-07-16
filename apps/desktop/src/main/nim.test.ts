import { describe, expect, it } from 'vitest';
import { extractVisionJson } from './nim.js';

describe('NIM 응답 파서', () => {
  it('코드 펜스 안의 구조화 결과를 검증한다', () => {
    const parsed = extractVisionJson('```json\n{"phase":"preview","confidence":0.91,"opponentPreview":["Gengar"],"ownActiveSpecies":null,"opponentActiveSpecies":null,"ownHpPercent":null,"opponentHpPercent":null,"ownStatus":null,"opponentStatus":null,"visibleMoves":[],"unknownFields":[],"notes":[]}\n```');
    expect(parsed.phase).toBe('preview');
    expect(parsed.opponentPreview).toEqual(['Gengar']);
  });

  it('스키마 밖 confidence를 거부한다', () => {
    expect(() => extractVisionJson('{"phase":"unknown","confidence":2}')).toThrow();
  });

  it('아이콘 슬롯 후보를 현재 규정의 영문 식별자로 정규화한다', () => {
    const parsed = extractVisionJson(JSON.stringify({
      phase: 'preview', confidence: 0.72, opponentPreview: ['대짱이'],
      opponentPreviewSlots: [
        { slot: 1, species: '대짱이', candidates: ['Swampert'], confidence: 0.92, evidence: '파란 몸과 큰 지느러미' },
        { slot: 2, species: '규정밖몬', candidates: ['한카리아스', 'Unknownmon'], confidence: 0.48, evidence: '상어 형태' },
      ],
      ownActiveSpecies: null, opponentActiveSpecies: null, ownHpPercent: null, opponentHpPercent: null,
      ownStatus: null, opponentStatus: null, visibleMoves: [], unknownFields: [], notes: [],
    }), [
      { name: 'Swampert', displayName: '대짱이' },
      { name: 'Garchomp', displayName: '한카리아스' },
    ]);
    expect(parsed.opponentPreview).toEqual(['Swampert']);
    expect(parsed.opponentPreviewSlots[0]?.species).toBe('Swampert');
    expect(parsed.opponentPreviewSlots[1]?.species).toBeNull();
    expect(parsed.opponentPreviewSlots[1]?.candidates).toEqual(['Garchomp']);
    expect(parsed.unknownFields).toContain('상대 미리보기 2번');
  });
});

