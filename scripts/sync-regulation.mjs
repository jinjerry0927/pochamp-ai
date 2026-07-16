import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiUrl = 'https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=Regulation_Set_M-B&prop=wikitext&format=json&formatversion=2';
const officialUrl = 'https://news.pokemon-home.com/en/page/776.html';
const catalogUrl = 'https://metavgc.com/guides/pokemon-champions-regulation-m-b-legal-pokemon-items-moves';

const headers = { 'user-agent': 'PochampAI/0.2 personal-research' };
const [response, catalogResponse] = await Promise.all([
  fetch(apiUrl, { headers }),
  fetch(catalogUrl, { headers }),
]);
if (!response.ok) throw new Error(`규정 미러를 가져오지 못했습니다: ${response.status}`);
if (!catalogResponse.ok) throw new Error(`M-B 기술·도구 카탈로그를 가져오지 못했습니다: ${catalogResponse.status}`);
const [payload, catalogHtml] = await Promise.all([response.json(), catalogResponse.text()]);
const wikiText = payload?.parse?.wikitext;
if (typeof wikiText !== 'string') throw new Error('규정 응답에 wikitext가 없습니다.');

const eligibleStart = wikiText.indexOf('==Eligible Pokémon==');
const megaStart = wikiText.indexOf('===Mega Evolutions===', eligibleStart);
if (eligibleStart < 0 || megaStart < 0) throw new Error('규정 섹션을 찾지 못했습니다.');

const normalizeForm = (base, suffix) => {
  if (!suffix) return base;
  const raw = suffix.replace(/^\s*-/, '').trim();
  const mapped = {
    'Paldea Combat': 'Paldea-Combat',
    'Paldea Blaze': 'Paldea-Blaze',
    'Paldea Aqua': 'Paldea-Aqua',
    Female: base === 'Basculegion' ? 'F' : 'F',
    Jumbo: 'Super',
  }[raw] ?? raw.replaceAll(' ', '-');
  return `${base}-${mapped}`;
};

const parseCards = (section) => [...section.matchAll(/\{\{CPCard\|(\d+)\|([^|}]+)([^}]*)\}\}/g)].map((match) => {
  const nationalDex = Number(match[1]);
  const base = match[2].trim();
  const tail = match[3] ?? '';
  const suffix = tail.match(/\|ig=([^|}]+)/)?.[1];
  return {
    id: normalizeForm(base, suffix).toLowerCase().replace(/[^a-z0-9]+/g, ''),
    name: normalizeForm(base, suffix),
    nationalDex,
  };
});

const eligibleSpecies = parseCards(wikiText.slice(eligibleStart, megaStart));
const megaEnd = wikiText.indexOf('==Related articles==', megaStart);
const allowedMegas = parseCards(wikiText.slice(megaStart, megaEnd < 0 ? undefined : megaEnd)).map((entry) => entry.name);

const decodeHtml = (value) => value
  .replace(/<[^>]+>/g, '')
  .replaceAll('&#x27;', "'")
  .replaceAll('&#39;', "'")
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .trim();

const parseCatalogTable = (headingId, expectedCount) => {
  const start = catalogHtml.indexOf(`id="${headingId}"`);
  const end = catalogHtml.indexOf('</table>', start);
  if (start < 0 || end < 0) throw new Error(`카탈로그 표를 찾지 못했습니다: ${headingId}`);
  const values = [...catalogHtml.slice(start, end).matchAll(/<td>(.*?)<\/td>/g)].map((match) => decodeHtml(match[1])).filter(Boolean);
  if (values.length !== expectedCount) throw new Error(`${headingId}: ${expectedCount}개를 예상했지만 ${values.length}개를 파싱했습니다.`);
  return values;
};

const allowedItems = parseCatalogTable('allowed-items-148', 148);
const allowedMoves = parseCatalogTable('allowed-moves-502', 502);

if (eligibleSpecies.length < 200) throw new Error(`예상보다 적은 종이 파싱되었습니다: ${eligibleSpecies.length}`);

const snapshot = {
  id: 'M-B@2026-07-16',
  regulation: 'M-B',
  checkedAt: '2026-07-16',
  activeFrom: '2026-06-17T02:00:00Z',
  activeUntil: '2026-09-02T01:59:00Z',
  format: 'single',
  bring: 6,
  select: 3,
  duplicateItemsAllowed: false,
  megaEvolutionLimit: 1,
  sources: [
    { kind: 'official', url: officialUrl },
    { kind: 'community-mirror', url: 'https://bulbapedia.bulbagarden.net/wiki/Regulation_Set_M-B' },
    { kind: 'community-catalog', url: catalogUrl }
  ],
  eligibleSpecies,
  allowedMegas,
  allowedItems,
  allowedMoves,
};

const jsonPath = resolve(root, 'data/regulations/m-b@2026-07-16.json');
const tsPath = resolve(root, 'packages/engine/src/generated/regulation-mb.ts');
await mkdir(dirname(jsonPath), { recursive: true });
await mkdir(dirname(tsPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
await writeFile(tsPath, `// scripts/sync-regulation.mjs에서 생성됩니다. 직접 수정하지 마세요.\nexport const regulationMB = ${JSON.stringify(snapshot, null, 2)} as const;\n`, 'utf8');
console.log(`M-B 규정 동기화 완료: ${eligibleSpecies.length}개 폼, 메가진화 ${allowedMegas.length}개, 도구 ${allowedItems.length}개, 기술 ${allowedMoves.length}개`);
