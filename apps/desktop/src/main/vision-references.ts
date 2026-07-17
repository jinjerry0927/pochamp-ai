import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface VisionSpeciesReference {
  name: string;
  displayName: string;
  nationalDex: number;
}

export interface NativeImageLike {
  getSize(): { width: number; height: number };
  crop(rect: { x: number; y: number; width: number; height: number }): NativeImageLike;
  resize(options: { width: number; height: number; quality?: 'good' | 'better' | 'best' }): NativeImageLike;
  toBitmap(): Buffer;
  toPNG(): Buffer;
  toDataURL(): string;
  isEmpty(): boolean;
}

export interface NativeImageFactoryLike {
  createFromBuffer(buffer: Buffer): NativeImageLike;
  createFromDataURL(dataUrl: string): NativeImageLike;
}

export interface LocalVisionCandidate {
  species: string;
  confidence: number;
  types: string[];
  source: 'seed' | 'learned';
}

export interface LocalVisionSlot {
  slot: number;
  imageDataUrl: string;
  candidates: LocalVisionCandidate[];
}

export interface VisionReferenceStatus {
  totalSpecies: number;
  seededSpecies: number;
  learnedSpecies: number;
  referenceCount: number;
  missingSpecies: number;
  seedCurrent: boolean;
}

export interface VisionTrainingSample {
  slot: number;
  species: string;
  imageDataUrl: string;
}

interface ReferenceEntry {
  id: string;
  species: string;
  kind: 'seed' | 'learned';
  cropRevision?: number;
  file: string;
  createdAt: string;
  types: string[];
  sourceUrl?: string;
}

interface ReferenceManifest {
  version: 2;
  seedRevision: number;
  entries: ReferenceEntry[];
}

interface CachedReference {
  entry: ReferenceEntry;
  descriptor: number[];
}

export interface PokeApiPokemonRow {
  id: number;
  identifier: string;
}

const GRID_SIZE = 16;
const MAX_LEARNED_PER_SPECIES = 20;
const SEED_REVISION = 2;
const CROP_REVISION = 2;
const POKEAPI_CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const SPRITE_ROOT = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const TYPE_NAMES: Record<number, string> = {
  1: 'Normal', 2: 'Fighting', 3: 'Flying', 4: 'Poison', 5: 'Ground', 6: 'Rock', 7: 'Bug', 8: 'Ghost', 9: 'Steel',
  10: 'Fire', 11: 'Water', 12: 'Grass', 13: 'Electric', 14: 'Psychic', 15: 'Ice', 16: 'Dragon', 17: 'Dark', 18: 'Fairy',
};

const toID = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
const safeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pokemon';
const clamp = (value: number, minimum = 0, maximum = 1): number => Math.max(minimum, Math.min(maximum, value));
const isCurrentReference = (entry: ReferenceEntry): boolean => entry.kind === 'seed' || entry.cropRevision === CROP_REVISION;

export interface ImageRect { x: number; y: number; width: number; height: number }

function fallbackOpponentSlotRect(size: { width: number; height: number }, slot: number): ImageRect {
  const index = Math.max(0, Math.min(5, slot - 1));
  const x = Math.floor(size.width * 0.797);
  const y = Math.floor(size.height * (0.16 + index * 0.108));
  return {
    x,
    y,
    width: Math.max(1, Math.min(size.width - x, Math.floor(size.width * 0.076))),
    height: Math.max(1, Math.min(size.height - y, Math.floor(size.height * 0.1))),
  };
}

export function opponentSlotRect(size: { width: number; height: number }, slot: number): ImageRect {
  return fallbackOpponentSlotRect(size, slot);
}

function isOpponentPanelPixel(bitmap: Buffer, offset: number): boolean {
  const blue = bitmap[offset] ?? 0;
  const green = bitmap[offset + 1] ?? 0;
  const red = bitmap[offset + 2] ?? 0;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const pixelSaturation = maximum ? (maximum - minimum) / maximum : 0;
  return red > 70
    && pixelSaturation > 0.42
    && red > green * 1.45
    && blue > green * 1.15;
}

/**
 * Champions의 상대 팀 카드는 반투명 적색/자홍색 패널 여섯 개로 표시된다.
 * 창 제목줄·검은 여백·작업 표시줄이 캡처에 포함돼도 패널 자체를 먼저 찾은 뒤,
 * 각 카드의 왼쪽 포켓몬 렌더 영역만 반환한다.
 */
export function detectOpponentSlotRectsFromBgra(bitmap: Buffer, width: number, height: number): ImageRect[] {
  if (width < 320 || height < 240 || bitmap.length < width * height * 4) return [];
  const xStart = Math.floor(width * 0.62);
  const xEnd = Math.min(width, Math.ceil(width * 0.96));
  const sampleStep = width >= 1000 ? 2 : 1;
  const rowThreshold = Math.max(12, Math.floor(((xEnd - xStart) / sampleStep) * 0.1));
  const activeRows: number[] = [];

  for (let y = 0; y < height; y += sampleStep) {
    let count = 0;
    for (let x = xStart; x < xEnd; x += sampleStep) {
      if (isOpponentPanelPixel(bitmap, (y * width + x) * 4)) count += 1;
    }
    if (count >= rowThreshold) activeRows.push(y);
  }

  const rowRuns: Array<{ start: number; end: number }> = [];
  for (const y of activeRows) {
    const current = rowRuns.at(-1);
    if (!current || y - current.end > sampleStep) rowRuns.push({ start: y, end: y });
    else current.end = y;
  }

  const cards = rowRuns
    .map((run) => ({ ...run, height: run.end - run.start + sampleStep }))
    .filter((run) => run.start >= height * 0.08
      && run.end <= height * 0.9
      && run.height >= height * 0.065
      && run.height <= height * 0.14)
    .map((run): ImageRect | null => {
      const columnThreshold = Math.max(4, Math.floor((run.height / sampleStep) * 0.12));
      const activeColumns: number[] = [];
      for (let x = xStart; x < xEnd; x += sampleStep) {
        let count = 0;
        for (let y = run.start; y <= run.end; y += sampleStep) {
          if (isOpponentPanelPixel(bitmap, (y * width + x) * 4)) count += 1;
        }
        if (count >= columnThreshold) activeColumns.push(x);
      }
      if (!activeColumns.length) return null;
      const panelLeft = activeColumns[0] ?? 0;
      const panelRight = Math.min(width, (activeColumns.at(-1) ?? panelLeft) + sampleStep);
      const panelWidth = panelRight - panelLeft;
      if (panelWidth < width * 0.1 || panelWidth > width * 0.22) return null;
      const x = Math.max(0, Math.floor(panelLeft + panelWidth * 0.13));
      const y = Math.max(0, run.start - sampleStep);
      return {
        x,
        y,
        width: Math.max(1, Math.min(width - x, Math.floor(panelWidth * 0.52))),
        height: Math.max(1, Math.min(height - y, run.height + sampleStep * 2)),
      };
    })
    .filter((rect): rect is ImageRect => Boolean(rect))
    .sort((left, right) => left.y - right.y);

  return cards.length === 6 ? cards : [];
}

function opponentSlotRects(image: NativeImageLike): ImageRect[] {
  const size = image.getSize();
  const detected = detectOpponentSlotRectsFromBgra(image.toBitmap(), size.width, size.height);
  return detected.length === 6
    ? detected
    : Array.from({ length: 6 }, (_, index) => fallbackOpponentSlotRect(size, index + 1));
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftLength += leftValue * leftValue;
    rightLength += rightValue * rightValue;
  }
  return leftLength && rightLength ? dot / Math.sqrt(leftLength * rightLength) : 0;
}

export function resolvePokeApiPokemonId(species: VisionSpeciesReference, rows: readonly PokeApiPokemonRow[]): number {
  const wanted = toID(species.name);
  const exact = rows.find((row) => toID(row.identifier) === wanted);
  if (exact) return exact.id;
  const close = rows
    .filter((row) => toID(row.identifier).startsWith(wanted) || wanted.startsWith(toID(row.identifier)))
    .sort((left, right) => Math.abs(toID(left.identifier).length - wanted.length) - Math.abs(toID(right.identifier).length - wanted.length))[0];
  return close?.id ?? species.nationalDex;
}

function normalizeVector(values: number[]): number[] {
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return length ? values.map((value) => value / length) : values;
}

function hue(r: number, g: number, b: number): number {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  if (!delta) return 0;
  const raw = maximum === red
    ? ((green - blue) / delta) % 6
    : maximum === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return ((raw * 60) + 360) % 360;
}

function saturation(r: number, g: number, b: number): number {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  return maximum ? (maximum - minimum) / maximum : 0;
}

function hueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
}

export function descriptorFromBgra(bitmap: Buffer, width: number, height: number, mode: 'seed' | 'capture'): number[] {
  if (bitmap.length < width * height * 4 || width < 1 || height < 1) return [];
  const pixel = (x: number, y: number): [number, number, number, number] => {
    const offset = (y * width + x) * 4;
    return [bitmap[offset + 2] ?? 0, bitmap[offset + 1] ?? 0, bitmap[offset] ?? 0, bitmap[offset + 3] ?? 255];
  };
  const edge: Array<[number, number, number]> = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < Math.max(2, Math.floor(width * 0.1)); x += 1) {
      const [r, g, b] = pixel(x, y);
      edge.push([r, g, b]);
    }
  }
  const background = edge.reduce((sum, entry) => [sum[0] + entry[0], sum[1] + entry[1], sum[2] + entry[2]], [0, 0, 0])
    .map((value) => value / Math.max(1, edge.length));
  const [backgroundRed = 0, backgroundGreen = 0, backgroundBlue = 0] = background;
  const backgroundHue = hue(backgroundRed, backgroundGreen, backgroundBlue);
  const mask = new Uint8Array(width * height);
  let minimumX = width;
  let minimumY = height;
  let maximumX = 0;
  let maximumY = 0;
  let foregroundCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const distance = Math.sqrt((r - backgroundRed) ** 2 + (g - backgroundGreen) ** 2 + (b - backgroundBlue) ** 2);
      const pixelHue = hue(r, g, b);
      const pixelSaturation = saturation(r, g, b);
      const opponentPanelBackground = pixelSaturation > 0.38 && pixelHue >= 285 && pixelHue <= 355;
      const foreground = mode === 'seed'
        ? a > 35
        : distance > 28 && !opponentPanelBackground
          && (pixelSaturation < 0.38 || hueDistance(pixelHue, backgroundHue) > 18);
      if (!foreground) continue;
      mask[y * width + x] = 1;
      foregroundCount += 1;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  if (foregroundCount < 10) {
    minimumX = 0;
    minimumY = 0;
    maximumX = width - 1;
    maximumY = height - 1;
    mask.fill(1);
  }
  const boxWidth = Math.max(1, maximumX - minimumX + 1);
  const boxHeight = Math.max(1, maximumY - minimumY + 1);
  const vector: number[] = [];
  const histogram = Array.from({ length: 12 }, () => 0);
  for (let targetY = 0; targetY < GRID_SIZE; targetY += 1) {
    for (let targetX = 0; targetX < GRID_SIZE; targetX += 1) {
      const sourceX = Math.min(maximumX, minimumX + Math.floor((targetX + 0.5) * boxWidth / GRID_SIZE));
      const sourceY = Math.min(maximumY, minimumY + Math.floor((targetY + 0.5) * boxHeight / GRID_SIZE));
      const active = mask[sourceY * width + sourceX] ? 1 : 0;
      const [r, g, b] = pixel(sourceX, sourceY);
      vector.push(active * 0.15, active * r / 510, active * g / 510, active * b / 510);
      const histogramIndex = Math.min(11, Math.floor(hue(r, g, b) / 30));
      if (active) histogram[histogramIndex] = (histogram[histogramIndex] ?? 0) + 1;
    }
  }
  const histogramTotal = Math.max(1, histogram.reduce((sum, value) => sum + value, 0));
  vector.push(...histogram.map((value) => value / histogramTotal * 5), boxWidth / width, boxHeight / height);
  return normalizeVector(vector);
}

function descriptorFromImage(image: NativeImageLike, mode: 'seed' | 'capture'): number[] {
  const resized = image.resize({ width: 32, height: 32, quality: 'better' });
  return descriptorFromBgra(resized.toBitmap(), 32, 32, mode);
}

function parsePokemonRows(csv: string): PokeApiPokemonRow[] {
  return csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [id, identifier] = line.split(',');
    return { id: Number(id), identifier: identifier ?? '' };
  }).filter((row) => Number.isInteger(row.id) && row.identifier);
}

function parsePokemonTypes(csv: string): Map<number, string[]> {
  const result = new Map<number, string[]>();
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [pokemonId = Number.NaN, typeId = Number.NaN] = line.split(',').map(Number);
    const name = TYPE_NAMES[typeId];
    if (!Number.isInteger(pokemonId) || !name) continue;
    result.set(pokemonId, [...(result.get(pokemonId) ?? []), name]);
  }
  return result;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'PochampAI/0.5 personal-reference-pack' } });
  if (!response.ok) throw new Error(`${url} 응답 ${response.status}`);
  return response.text();
}

async function fetchFirstImage(urls: readonly string[]): Promise<{ buffer: Buffer; url: string } | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'PochampAI/0.5 personal-reference-pack' } });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 32 && buffer.length < 2_000_000) return { buffer, url };
    } catch {
      // 다음 공식 미러 스타일을 시도한다.
    }
  }
  return null;
}

export class VisionReferenceStore {
  private readonly manifestPath: string;
  private readonly allowed = new Map<string, VisionSpeciesReference>();
  private manifest: ReferenceManifest = { version: 2, seedRevision: 0, entries: [] };
  private cache: CachedReference[] = [];
  private initialized = false;

  constructor(
    private readonly root: string,
    species: readonly VisionSpeciesReference[],
    private readonly images: NativeImageFactoryLike,
  ) {
    this.manifestPath = join(root, 'manifest.json');
    for (const entry of species) this.allowed.set(entry.name, entry);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.root, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.manifestPath, 'utf8')) as Partial<ReferenceManifest>;
      this.manifest = {
        version: 2,
        seedRevision: Number.isInteger(parsed.seedRevision) ? parsed.seedRevision ?? 0 : 0,
        entries: Array.isArray(parsed.entries) ? parsed.entries.filter((entry) => this.allowed.has(entry.species)) : [],
      };
    } catch {
      this.manifest = { version: 2, seedRevision: 0, entries: [] };
    }
    await this.reloadCache();
    this.initialized = true;
  }

  private async reloadCache(): Promise<void> {
    const loaded = await Promise.all(this.manifest.entries.filter(isCurrentReference).map(async (entry): Promise<CachedReference | null> => {
      try {
        const image = this.images.createFromBuffer(await readFile(join(this.root, entry.file)));
        if (image.isEmpty()) return null;
        return { entry, descriptor: descriptorFromImage(image, entry.kind === 'seed' ? 'seed' : 'capture') };
      } catch {
        return null;
      }
    }));
    this.cache = loaded.filter((entry): entry is CachedReference => Boolean(entry?.descriptor.length));
  }

  private async saveManifest(): Promise<void> {
    await writeFile(this.manifestPath, `${JSON.stringify(this.manifest, null, 2)}\n`, 'utf8');
  }

  async status(): Promise<VisionReferenceStatus> {
    await this.initialize();
    const seeded = new Set(this.manifest.entries.filter((entry) => entry.kind === 'seed').map((entry) => entry.species));
    const currentEntries = this.manifest.entries.filter(isCurrentReference);
    const learned = new Set(currentEntries.filter((entry) => entry.kind === 'learned').map((entry) => entry.species));
    return {
      totalSpecies: this.allowed.size,
      seededSpecies: seeded.size,
      learnedSpecies: learned.size,
      referenceCount: currentEntries.length,
      missingSpecies: Math.max(0, this.allowed.size - seeded.size),
      seedCurrent: this.manifest.seedRevision >= SEED_REVISION,
    };
  }

  async seed(): Promise<VisionReferenceStatus> {
    await this.initialize();
    const [pokemonCsv, typesCsv] = await Promise.all([
      fetchText(`${POKEAPI_CSV}/pokemon.csv`),
      fetchText(`${POKEAPI_CSV}/pokemon_types.csv`),
    ]);
    const rows = parsePokemonRows(pokemonCsv);
    const types = parsePokemonTypes(typesCsv);
    const existing = new Set(this.manifest.entries.filter((entry) => entry.kind === 'seed').map((entry) => entry.species));
    const pending = [...this.allowed.values()].filter((entry) => this.manifest.seedRevision < SEED_REVISION || !existing.has(entry.name));
    const additions: ReferenceEntry[] = [];
    let cursor = 0;
    const workers = Array.from({ length: 8 }, async () => {
      while (cursor < pending.length) {
        const species = pending[cursor++];
        if (!species) break;
        const pokemonId = resolvePokeApiPokemonId(species, rows);
        const identifiers = [...new Set([pokemonId, species.nationalDex])];
        const urls = identifiers.flatMap((id) => [
          `${SPRITE_ROOT}/versions/generation-ix/scarlet-violet/${id}.png`,
          `${SPRITE_ROOT}/versions/generation-viii/icons/${id}.png`,
          `${SPRITE_ROOT}/other/home/${id}.png`,
          `${SPRITE_ROOT}/other/official-artwork/${id}.png`,
          `${SPRITE_ROOT}/${id}.png`,
        ]);
        const downloaded = await fetchFirstImage(urls);
        if (!downloaded) continue;
        const image = this.images.createFromBuffer(downloaded.buffer);
        if (image.isEmpty()) continue;
        const file = join('seed', `${safeName(species.name)}.png`);
        await mkdir(join(this.root, 'seed'), { recursive: true });
        await writeFile(join(this.root, file), image.toPNG());
        additions.push({
          id: randomUUID(), species: species.name, kind: 'seed', file, createdAt: new Date().toISOString(),
          types: types.get(pokemonId) ?? types.get(species.nationalDex) ?? [], sourceUrl: downloaded.url,
        });
      }
    });
    await Promise.all(workers);
    const refreshedSpecies = new Set(additions.map((entry) => entry.species));
    this.manifest.entries = this.manifest.entries.filter((entry) => entry.kind !== 'seed' || !refreshedSpecies.has(entry.species));
    this.manifest.entries.push(...additions);
    this.manifest.seedRevision = SEED_REVISION;
    await this.saveManifest();
    await this.reloadCache();
    return this.status();
  }

  async learn(samples: readonly VisionTrainingSample[]): Promise<VisionReferenceStatus> {
    await this.initialize();
    const learnedDirectory = join(this.root, 'learned');
    await mkdir(learnedDirectory, { recursive: true });
    for (const sample of samples) {
      const species = this.allowed.get(sample.species);
      if (!species || !/^data:image\/png;base64,/i.test(sample.imageDataUrl) || sample.imageDataUrl.length > 2_000_000) continue;
      const currentCount = this.manifest.entries.filter((entry) => entry.kind === 'learned' && entry.cropRevision === CROP_REVISION && entry.species === sample.species).length;
      if (currentCount >= MAX_LEARNED_PER_SPECIES) continue;
      const image = this.images.createFromDataURL(sample.imageDataUrl);
      if (image.isEmpty()) continue;
      const id = randomUUID();
      const file = join('learned', `${safeName(sample.species)}-${id}.png`);
      await writeFile(join(this.root, file), image.toPNG());
      const seed = this.manifest.entries.find((entry) => entry.species === sample.species && entry.kind === 'seed');
      this.manifest.entries.push({ id, species: sample.species, kind: 'learned', cropRevision: CROP_REVISION, file, createdAt: new Date().toISOString(), types: seed?.types ?? [] });
    }
    await this.saveManifest();
    await this.reloadCache();
    return this.status();
  }

  async matchPreview(image: NativeImageLike): Promise<LocalVisionSlot[]> {
    await this.initialize();
    if (image.isEmpty()) return [];
    const rects = opponentSlotRects(image);
    return Array.from({ length: 6 }, (_, index): LocalVisionSlot => {
      const slotImage = image.crop(rects[index] ?? opponentSlotRect(image.getSize(), index + 1));
      const descriptor = descriptorFromImage(slotImage, 'capture');
      const bySpecies = new Map<string, { score: number; entry: ReferenceEntry }>();
      for (const reference of this.cache) {
        const score = cosineSimilarity(descriptor, reference.descriptor) + (reference.entry.kind === 'learned' ? 0.035 : 0);
        const current = bySpecies.get(reference.entry.species);
        if (!current || score > current.score) bySpecies.set(reference.entry.species, { score, entry: reference.entry });
      }
      const ranked = [...bySpecies.values()].sort((left, right) => right.score - left.score).slice(0, 4);
      const candidates = ranked.slice(0, 3).map((candidate, candidateIndex): LocalVisionCandidate => {
        const nextScore = ranked[candidateIndex + 1]?.score ?? 0;
        const confidence = clamp(((candidate.score - 0.4) / 0.5) * 0.86
          + (candidateIndex === 0 ? Math.max(0, candidate.score - nextScore) * 0.7 : 0)
          - candidateIndex * 0.04, 0.02, 0.99);
        return { species: candidate.entry.species, confidence, types: candidate.entry.types, source: candidate.entry.kind };
      });
      return { slot: index + 1, imageDataUrl: slotImage.toDataURL(), candidates };
    });
  }
}
