import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeWithNim, extractVisionJson } from './nim.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it('화면 분석 제한시간 초과를 사용자가 이해할 수 있는 오류로 바꾼다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })));
    const analysis = analyzeWithNim({
      apiKey: 'test-key',
      model: 'test-model',
      imageDataUrl: 'data:image/png;base64,AA==',
      allowedSpecies: [],
      timeoutMs: 1_000,
    });
    const rejection = expect(analysis).rejects.toThrow('NVIDIA 화면 분석이 1초 안에 완료되지 않았습니다.');
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });
});

