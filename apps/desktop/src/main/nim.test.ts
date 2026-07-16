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
});

