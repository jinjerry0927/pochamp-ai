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

const toID = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value); value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers, ...values] = rows;
  if (!headers) return [];
  return values.map((fields) => Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ''])));
};

const csvBase = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const csvFiles = [
  'pokemon_species.csv', 'pokemon_species_names.csv', 'pokemon.csv', 'pokemon_forms.csv', 'pokemon_form_names.csv',
  'moves.csv', 'move_names.csv', 'abilities.csv', 'ability_names.csv', 'items.csv', 'item_names.csv', 'natures.csv', 'nature_names.csv',
];
const csvPairs = await Promise.all(csvFiles.map(async (file) => {
  const csvResponse = await fetch(`${csvBase}${file}`, { headers });
  if (!csvResponse.ok) throw new Error(`PokéAPI 한국어 데이터 ${file}을 가져오지 못했습니다: ${csvResponse.status}`);
  return [file, parseCsv(await csvResponse.text())];
}));
const csv = Object.fromEntries(csvPairs);

const localizedEntityMap = (indexFile, namesFile, idColumn) => {
  const koById = new Map(csv[namesFile].filter((row) => row.local_language_id === '3').map((row) => [row[idColumn], row.name]));
  return Object.fromEntries(csv[indexFile]
    .map((row) => [toID(row.identifier), koById.get(row.id)])
    .filter((entry) => entry[1]));
};

const speciesKoById = new Map(csv['pokemon_species_names.csv']
  .filter((row) => row.local_language_id === '3')
  .map((row) => [row.pokemon_species_id, row.name]));
const speciesIdByIdentifier = new Map(csv['pokemon_species.csv'].map((row) => [toID(row.identifier), row.id]));
const pokemonSpeciesId = new Map(csv['pokemon.csv'].map((row) => [row.id, row.species_id]));
const formKoById = new Map(csv['pokemon_form_names.csv']
  .filter((row) => row.local_language_id === '3')
  .map((row) => [row.pokemon_form_id, row.pokemon_name || row.form_name]));
const formRowsByIdentifier = new Map(csv['pokemon_forms.csv'].map((row) => [toID(row.identifier), row]));

const localizeSpecies = (entry) => {
  const id = toID(entry.name);
  const exactSpeciesId = speciesIdByIdentifier.get(id);
  if (exactSpeciesId && speciesKoById.get(exactSpeciesId)) return speciesKoById.get(exactSpeciesId);
  const form = formRowsByIdentifier.get(id);
  const baseName = speciesKoById.get(form ? pokemonSpeciesId.get(form.pokemon_id) : String(entry.nationalDex));
  const formName = form ? formKoById.get(form.id) : undefined;
  if (!baseName) return entry.name;
  if (!formName) return baseName;
  return formName.includes(baseName) ? formName : `${baseName} (${formName})`;
};

const allMovesKo = localizedEntityMap('moves.csv', 'move_names.csv', 'move_id');
const allAbilitiesKo = localizedEntityMap('abilities.csv', 'ability_names.csv', 'ability_id');
const allItemsKo = localizedEntityMap('items.csv', 'item_names.csv', 'item_id');
const allNaturesKo = localizedEntityMap('natures.csv', 'nature_names.csv', 'nature_id');
const localization = {
  checkedAt: snapshot.checkedAt,
  source: 'https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv',
  language: 'ko',
  species: Object.fromEntries(eligibleSpecies.map((entry) => [toID(entry.name), localizeSpecies(entry)])),
  moves: Object.fromEntries(allowedMoves.map((name) => [toID(name), allMovesKo[toID(name)] ?? name])),
  abilities: allAbilitiesKo,
  items: Object.fromEntries(allowedItems.map((name) => [toID(name), allItemsKo[toID(name)] ?? name])),
  natures: Object.fromEntries(['Lonely', 'Adamant', 'Naughty', 'Brave', 'Bold', 'Impish', 'Lax', 'Relaxed', 'Modest', 'Mild', 'Rash', 'Quiet', 'Calm', 'Gentle', 'Careful', 'Sassy', 'Timid', 'Hasty', 'Jolly', 'Naive', 'Serious']
    .map((name) => [toID(name), allNaturesKo[toID(name)] ?? name])),
};

const championsItemSpecies = {
  Barbaracleite: 'Barbaracle', Chandelurite: 'Chandelure', Chesnaughtite: 'Chesnaught', Chimechite: 'Chimecho', Clefablite: 'Clefable',
  Crabominite: 'Crabominable', Delphoxite: 'Delphox', Dragalgeite: 'Dragalge', Dragoninite: 'Dragonite', Drampanite: 'Drampa',
  Eelektrossite: 'Eelektross', Emboarite: 'Emboar', Excadrite: 'Excadrill', Falinksite: 'Falinks', Feraligite: 'Feraligatr',
  Floettite: 'Floette-Eternal', Froslassite: 'Froslass', Glimmoranite: 'Glimmora', Golurkite: 'Golurk', Greninjite: 'Greninja',
  Hawluchanite: 'Hawlucha', Malamarite: 'Malamar', Mawileite: 'Mawile', Meganiumite: 'Meganium', Meowsticite: 'Meowstic-F',
  Pyroarite: 'Pyroar', Sceptileite: 'Sceptile', Scolipedeite: 'Scolipede', Scovillainite: 'Scovillain', Scraftyite: 'Scrafty',
  Skarmorite: 'Skarmory', Staraptorite: 'Staraptor', Starminite: 'Starmie', Victreebelite: 'Victreebel',
};
for (const [item, speciesName] of Object.entries(championsItemSpecies)) {
  const speciesLabel = localization.species[toID(speciesName)];
  if (speciesLabel) localization.items[toID(item)] = `${speciesLabel.replace(/\s*\([^)]*\)$/, '')}나이트`;
}
if (localization.species.raichu) {
  localization.items.raichunitex = `${localization.species.raichu}나이트X`;
  localization.items.raichunitey = `${localization.species.raichu}나이트Y`;
}
localization.items.fairyfeather = '요정의깃털';

const metaUrl = 'https://www.pikalytics.com/pokedex/battledataregmbs3';
const metaResponse = await fetch(metaUrl, { headers });
if (!metaResponse.ok) throw new Error(`M-B 사용률 페이지를 가져오지 못했습니다: ${metaResponse.status}`);
const metaIndexHtml = await metaResponse.text();
const topStart = metaIndexHtml.indexOf('Top 20 Pokemon');
const topEnd = metaIndexHtml.indexOf('Common Team Cores', topStart);
const topSpecies = [...new Set([...metaIndexHtml.slice(topStart, topEnd).matchAll(/\/pokedex\/battledataregmbs3\/([^"?/<]+)/g)]
  .map((match) => decodeURIComponent(match[1])))]
  .slice(0, 25);

const usageSection = (html, startMarker, endMarkers) => {
  const start = html.indexOf(startMarker);
  if (start < 0) return [];
  const end = Math.min(...endMarkers.map((marker) => html.indexOf(marker, start + startMarker.length)).filter((index) => index > start));
  const section = html.slice(start, Number.isFinite(end) ? end : undefined);
  return [...section.matchAll(/pokedex-inline-text(?:-offset)?">([^<]+)<\/div>[\s\S]{0,700}?pokedex-inline-right">([\d.]+)%<\/div>/g)]
    .map((match) => ({ name: decodeHtml(match[1]), usage: Number(match[2]) }));
};

const metaSpeciesEntries = await Promise.all(topSpecies.map(async (speciesName, rank) => {
  const pageResponse = await fetch(`${metaUrl}/${encodeURIComponent(speciesName)}?l=en`, { headers });
  if (!pageResponse.ok) return null;
  const html = await pageResponse.text();
  return [toID(speciesName), {
    name: speciesName,
    rank: rank + 1,
    moves: usageSection(html, 'id="moves_wrapper"', ['Best Teammates for', 'id="teammates_wrapper"']),
    items: usageSection(html, 'id="items_wrapper"', ['Best Abilities for', 'id="abilities_wrapper"']),
    abilities: usageSection(html, 'id="abilities_wrapper"', ['id="dex_spreads_wrapper"', 'id="dex_natures_wrapper"']),
    statAlignments: usageSection(html, 'id="dex_natures_wrapper"', ['Type Matchups for', 'pokedex-matchup-wrapper']),
  }];
}));

const meta = {
  regulationId: snapshot.id,
  checkedAt: snapshot.checkedAt,
  source: metaUrl,
  format: 'Pokemon Champions Regulation Set M-B S3 Ranked Battle Data',
  limitation: '대회·랭크 공개 데이터이며 싱글 친선전의 실제 승률로 직접 해석하지 않습니다.',
  species: Object.fromEntries(metaSpeciesEntries.filter(Boolean)),
  cores: [
    { id: 'rain-swampert', label: '비 · 대짱이 코어', species: ['Pelipper', 'Swampert', 'Archaludon'], usage: 12.2 },
  ],
};

const jsonPath = resolve(root, 'data/regulations/m-b@2026-07-16.json');
const tsPath = resolve(root, 'packages/engine/src/generated/regulation-mb.ts');
const localizationPath = resolve(root, 'packages/engine/src/generated/localization-ko.ts');
const metaPath = resolve(root, 'packages/engine/src/generated/meta-mb.ts');
await mkdir(dirname(jsonPath), { recursive: true });
await mkdir(dirname(tsPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
await writeFile(tsPath, `// scripts/sync-regulation.mjs에서 생성됩니다. 직접 수정하지 마세요.\nexport const regulationMB = ${JSON.stringify(snapshot, null, 2)} as const;\n`, 'utf8');
await writeFile(localizationPath, `// scripts/sync-regulation.mjs에서 생성됩니다. 직접 수정하지 마세요.\nexport const localizationKo = ${JSON.stringify(localization, null, 2)} as const;\n`, 'utf8');
await writeFile(metaPath, `// scripts/sync-regulation.mjs에서 생성됩니다. 직접 수정하지 마세요.\nexport const regulationMBMeta = ${JSON.stringify(meta, null, 2)} as const;\n`, 'utf8');
console.log(`M-B 동기화 완료: ${eligibleSpecies.length}개 폼, 한글 기술 ${Object.keys(localization.moves).length}개, 메타 ${Object.keys(meta.species).length}종`);
