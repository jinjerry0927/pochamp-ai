import { visionResultSchema, type VisionResult } from '@pochamp/engine';
import type { LocalVisionSlot } from '../shared/contracts.js';

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
export interface VisionSpeciesCandidate { name: string; displayName: string }

const compact = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s\-_.()]/g, '');

export function sanitizeVisionResult(result: VisionResult, catalog: VisionSpeciesCandidate[]): VisionResult {
  if (!catalog.length) return result;
  const lookup = new Map<string, string>();
  for (const entry of catalog) {
    lookup.set(compact(entry.name), entry.name);
    lookup.set(compact(entry.displayName), entry.name);
  }
  const resolve = (value: string | null): string | null => value ? lookup.get(compact(value)) ?? null : null;
  const slots = result.opponentPreviewSlots
    .map((slot) => ({
      ...slot,
      species: resolve(slot.species),
      candidates: [...new Set(slot.candidates.map((candidate) => resolve(candidate)).filter((candidate): candidate is string => Boolean(candidate)))].slice(0, 3),
    }))
    .sort((left, right) => left.slot - right.slot)
    .filter((slot, index, all) => all.findIndex((candidate) => candidate.slot === slot.slot) === index)
    .slice(0, 6);
  const preview = [...new Set([
    ...result.opponentPreview.map((entry) => resolve(entry)).filter((entry): entry is string => Boolean(entry)),
    ...slots.map((slot) => slot.species).filter((entry): entry is string => Boolean(entry)),
  ])].slice(0, 6);
  const unresolved = slots.filter((slot) => !slot.species).map((slot) => `상대 미리보기 ${slot.slot}번`);
  return {
    ...result,
    opponentPreview: preview,
    opponentPreviewSlots: slots,
    ownActiveSpecies: resolve(result.ownActiveSpecies),
    opponentActiveSpecies: resolve(result.opponentActiveSpecies),
    unknownFields: [...new Set([...result.unknownFields, ...unresolved])],
  };
}

export function extractVisionJson(content: string, catalog: VisionSpeciesCandidate[] = []): VisionResult {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('NVIDIA 응답에서 JSON을 찾지 못했습니다.');
  return sanitizeVisionResult(visionResultSchema.parse(JSON.parse(candidate)), catalog);
}

export async function analyzeWithNim(args: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  allowedSpecies: VisionSpeciesCandidate[];
  localVisionSlots?: LocalVisionSlot[];
  timeoutMs?: number;
}): Promise<VisionResult> {
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? 25_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const allowed = args.allowedSpecies.map((entry) => `${entry.displayName} (${entry.name})`).join(', ');
  const localCandidates = args.localVisionSlots?.map((slot) => {
    const candidates = slot.candidates.map((candidate) => `${candidate.species}[${candidate.types.join('/') || '타입 미확인'}] ${Math.round(candidate.confidence * 100)}% ${candidate.source === 'learned' ? 'Champions 학습 이미지' : '초기 아이콘'}`);
    return `슬롯 ${slot.slot}: ${candidates.join(', ') || '로컬 후보 없음'}`;
  }).join('\n') ?? '로컬 참조 이미지가 아직 없습니다.';
  const prompt = `당신은 한국어 Pokémon Champions 배틀 화면 판독기입니다. 전략이나 행동을 추천하지 말고 화면에서 확인되는 사실만 JSON으로 반환하세요.

현재 규정 포켓몬/폼 후보: ${allowed}

로컬 이미지 대조 Top 3 후보:
${localCandidates}

팀 미리보기 화면은 보통 왼쪽 파란/보라 패널이 사용자 팀, 오른쪽 빨간 패널이 상대 팀입니다. 반드시 오른쪽 상대 패널의 세로 6칸만 opponentPreviewSlots 1~6번에 위에서 아래 순서로 대응시키고 왼쪽 사용자 팀을 섞지 마세요. 싱글은 출전 3마리, 더블은 4마리를 고르지만 미리보기 명단은 양쪽 모두 6마리입니다. 유튜브 자막·타이머·트레이너 이름·선택 번호 오버레이는 포켓몬 정보가 아니므로 무시하세요.
포켓몬 이름 없이 초상화나 아이콘만 보여도 색, 실루엣, 얼굴, 귀·날개·뿔·몸 형태, 타입 아이콘과 지역/성별 폼 차이를 현재 규정 후보와 비교하세요.
- 로컬 후보는 보조 증거입니다. 'Champions 학습 이미지' 후보를 초기 아이콘보다 우선하되, 화면의 포켓몬 외형·타입 아이콘·성별 기호와 충돌하면 버리세요.
- 로컬 후보에 정답이 없다고 판단되면 전체 현재 규정 후보에서 직접 찾으세요.
- 한 종을 충분히 식별했으면 species에 영문 후보명을 넣으세요.
- 애매하면 species는 null로 두고 candidates에 가능성이 높은 후보를 최대 3개 넣으세요.
- evidence에는 화면에서 실제로 본 짧은 시각 단서만 기록하세요.
- 이름이 보이지 않는다는 이유만으로 6개 슬롯 전체를 비우지 마세요.
- 현재 규정 후보에 없는 이름은 반환하지 마세요.
- 추측한 값을 확정하지 말고 confidence와 unknownFields에 불확실성을 남기세요.
- 배틀 중 ownStatus/opponentStatus는 none|burn|poison|toxic|paralysis|sleep|freeze|unknown 중 하나만 사용하세요.
- 하품을 맞아 다음 턴 잠드는 상태는 drowsy, 혼란은 confusion, 도발은 taunt로 volatile status에 기록하세요.
- 트릭룸 표시나 직전 사용 문구가 보이면 남은 턴을 1~5로 기록하세요. 날씨·필드·상대가 실제로 사용해 공개된 기술도 보이는 사실만 기록하세요.

설명이나 마크다운 없이 다음 구조만 반환하세요:
{"phase":"preview|turn|forced-switch|result|unknown","confidence":0.0,"opponentPreview":[],"opponentPreviewSlots":[{"slot":1,"species":null,"candidates":[],"confidence":0.0,"evidence":""}],"ownActiveSpecies":null,"opponentActiveSpecies":null,"ownHpPercent":null,"opponentHpPercent":null,"ownStatus":null,"opponentStatus":null,"ownVolatileStatuses":[],"opponentVolatileStatuses":[],"weather":null,"terrain":null,"trickRoomTurns":null,"visibleMoves":[],"unknownFields":[],"notes":[]}`;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: args.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: args.imageDataUrl } },
          ],
        }],
        temperature: 0.1,
        top_p: 0.2,
        max_tokens: 1800,
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`NVIDIA API 오류 ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const rawContent = payload.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent : rawContent?.map((part) => part.text ?? '').join('') ?? '';
    return extractVisionJson(content, args.allowedSpecies);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`NVIDIA 화면 분석이 ${Math.round(timeoutMs / 1000)}초 안에 완료되지 않았습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
