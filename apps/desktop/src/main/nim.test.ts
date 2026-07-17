import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeWithNim, extractVisionJson } from './nim.js';
import { mergeLocalCandidates } from './vision-merge.js';

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

  it('opponentPreview에 슬롯 객체가 오면 문자열 명단과 슬롯 배열로 복구한다', () => {
    const parsed = extractVisionJson(JSON.stringify({
      phase: 'preview',
      confidence: 0.84,
      opponentPreview: [
        { slot: 1, species: 'Conkeldurr', candidates: [{ species: 'Machamp' }], confidence: 0.88, evidence: '격투 타입' },
        { slot: 2, name: 'Barraskewda', candidates: [], confidence: 0.81, evidence: '물 타입' },
      ],
    }), [
      { name: 'Conkeldurr', displayName: '노보청' },
      { name: 'Machamp', displayName: '괴력몬' },
      { name: 'Barraskewda', displayName: '꼬치조' },
    ]);
    expect(parsed.opponentPreview).toEqual(['Conkeldurr', 'Barraskewda']);
    expect(parsed.opponentPreviewSlots).toMatchObject([
      { slot: 1, species: 'Conkeldurr', candidates: ['Machamp'] },
      { slot: 2, species: 'Barraskewda', candidates: [] },
    ]);
  });

  it('스키마 밖 confidence를 거부한다', () => {
    expect(() => extractVisionJson('{"phase":"unknown","confidence":2}')).toThrow();
  });

  it('첫 JSON 뒤에 추가 JSON이나 설명이 붙어도 첫 결과만 파싱한다', () => {
    const parsed = extractVisionJson('{"phase":"preview","confidence":0.7}\n{"debug":true}');
    expect(parsed.phase).toBe('preview');
    expect(parsed.confidence).toBe(0.7);
  });

  it('AI 후보 1순위와 로컬 템플릿 1순위가 같으면 종을 자동 확정한다', () => {
    const parsed = extractVisionJson(JSON.stringify({
      phase: 'preview',
      confidence: 0.6,
      opponentPreview: [],
      opponentPreviewSlots: [{ slot: 1, species: null, candidates: ['Conkeldurr'], confidence: 0.6, evidence: '격투 타입과 기둥' }],
    }));
    const merged = mergeLocalCandidates(parsed, [{
      slot: 1,
      imageDataUrl: 'data:image/png;base64,AA==',
      candidates: [{ species: 'Conkeldurr', confidence: 0.7, types: ['Fighting'], source: 'seed' }],
    }]);
    expect(merged.opponentPreview).toEqual(['Conkeldurr']);
    expect(merged.opponentPreviewSlots[0]?.species).toBe('Conkeldurr');
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

  it('상대 미리보기는 전체 화면 대신 순서가 고정된 슬롯 이미지 여섯 장을 전송한다', async () => {
    const images = Array.from({ length: 6 }, (_, index) => `data:image/png;base64,SLOT${index + 1}`);
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        max_tokens: number;
        reasoning_budget?: number;
        messages: Array<{ content: Array<{ type: string; image_url?: { url: string }; text?: string }> }>;
      };
      const content = body.messages[0]?.content ?? [];
      expect(content.filter((entry) => entry.type === 'image_url').map((entry) => entry.image_url?.url)).toEqual(images);
      expect(body.max_tokens).toBe(900);
      expect(body.reasoning_budget).toBe(256);
      expect(content.find((entry) => entry.type === 'text')?.text).toContain('image N is opponent slot N');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"phase":"preview","confidence":0.9,"opponentPreview":[],"ownActiveSpecies":null,"opponentActiveSpecies":null,"ownHpPercent":null,"opponentHpPercent":null,"ownStatus":null,"opponentStatus":null,"visibleMoves":[],"unknownFields":[],"notes":[]}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await analyzeWithNim({
      apiKey: 'test-key',
      model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      imageDataUrl: 'data:image/png;base64,FULL',
      slotImageDataUrls: images,
      allowedSpecies: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

