import { visionResultSchema, type VisionResult } from '@pochamp/engine';

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
  timeoutMs?: number;
}): Promise<VisionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 12_000);
  const allowed = args.allowedSpecies.map((entry) => `${entry.displayName} (${entry.name})`).join(', ');
  const prompt = `당신은 한국어 Pokémon Champions 배틀 화면 판독기입니다. 전략이나 행동을 추천하지 말고 화면에서 확인되는 사실만 JSON으로 반환하세요.

현재 규정 포켓몬/폼 후보: ${allowed}

팀 미리보기 화면에는 포켓몬 이름 없이 초상화나 아이콘 6개만 표시될 수 있습니다. 텍스트 OCR이 없더라도 각 아이콘을 왼쪽에서 오른쪽, 위에서 아래 순서로 1~6번 슬롯에 대응시키세요. 색, 실루엣, 얼굴, 귀·날개·뿔·몸 형태와 지역/성별 폼 차이를 규정 후보와 비교하세요.
- 한 종을 충분히 식별했으면 species에 영문 후보명을 넣으세요.
- 애매하면 species는 null로 두고 candidates에 가능성이 높은 후보를 최대 3개 넣으세요.
- evidence에는 화면에서 실제로 본 짧은 시각 단서만 기록하세요.
- 이름이 보이지 않는다는 이유만으로 6개 슬롯 전체를 비우지 마세요.
- 현재 규정 후보에 없는 이름은 반환하지 마세요.
- 추측한 값을 확정하지 말고 confidence와 unknownFields에 불확실성을 남기세요.

설명이나 마크다운 없이 다음 구조만 반환하세요:
{"phase":"preview|turn|forced-switch|result|unknown","confidence":0.0,"opponentPreview":[],"opponentPreviewSlots":[{"slot":1,"species":null,"candidates":[],"confidence":0.0,"evidence":""}],"ownActiveSpecies":null,"opponentActiveSpecies":null,"ownHpPercent":null,"opponentHpPercent":null,"ownStatus":null,"opponentStatus":null,"visibleMoves":[],"unknownFields":[],"notes":[]}`;

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
  } finally {
    clearTimeout(timeout);
  }
}
