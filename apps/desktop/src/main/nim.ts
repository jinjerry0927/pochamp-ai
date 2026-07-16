import { visionResultSchema, type VisionResult } from '@pochamp/engine';

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

export function extractVisionJson(content: string): VisionResult {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('NVIDIA 응답에서 JSON을 찾지 못했습니다.');
  return visionResultSchema.parse(JSON.parse(candidate));
}

export async function analyzeWithNim(args: {
  apiKey: string;
  model: string;
  imageDataUrl: string;
  allowedSpecies: string[];
  timeoutMs?: number;
}): Promise<VisionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 12_000);
  const allowed = args.allowedSpecies.join(', ');
  const prompt = `당신은 Pokémon Champions 한국어 화면 판독기입니다. 전략을 추천하지 말고 화면에 보이는 사실만 JSON으로 반환하세요.
허용 포켓몬 이름: ${allowed}
애매한 값은 추측하지 말고 null 또는 unknownFields에 넣으세요. 설명이나 마크다운 없이 다음 구조만 반환하세요:
{"phase":"preview|turn|forced-switch|result|unknown","confidence":0.0,"opponentPreview":[],"ownActiveSpecies":null,"opponentActiveSpecies":null,"ownHpPercent":null,"opponentHpPercent":null,"ownStatus":null,"opponentStatus":null,"visibleMoves":[],"unknownFields":[],"notes":[]}`;

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
        max_tokens: 1200,
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`NVIDIA API 오류 ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const rawContent = payload.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent : rawContent?.map((part) => part.text ?? '').join('') ?? '';
    return extractVisionJson(content);
  } finally {
    clearTimeout(timeout);
  }
}

