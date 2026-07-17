import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [frameArgument, referenceRootArgument, userDataRootArgument, validationMode] = process.argv.slice(2);
if (!frameArgument || !referenceRootArgument || !userDataRootArgument) {
  console.error('사용법: node scripts/validate-nim-frame.mjs <frame.png> <vision-reference-root> <user-data-root>');
  process.exit(1);
}

const framePath = resolve(frameArgument);
const referenceRoot = resolve(referenceRootArgument);
const userDataRoot = resolve(userDataRootArgument);
const cacheRoot = resolve('node_modules/.cache');
await mkdir(cacheRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(join(cacheRoot, 'pochamp-nim-validation-'));
const runnerPath = join(temporaryDirectory, 'runner.mjs');
const marker = 'POCHAMP_NIM_RESULT=';
await writeFile(join(temporaryDirectory, 'package.json'), '{"type":"module"}\n', 'utf8');

const compiler = spawn(process.execPath, [
  resolve('node_modules/typescript/bin/tsc'),
  resolve('apps/desktop/src/main/vision-references.ts'),
  resolve('apps/desktop/src/main/nim.ts'),
  resolve('apps/desktop/src/main/vision-merge.ts'),
  resolve('apps/desktop/src/main/store.ts'),
  '--module', 'nodenext', '--target', 'es2022', '--rootDir', resolve('apps/desktop/src'), '--outDir', temporaryDirectory,
  '--noCheck', '--skipLibCheck',
], {
  cwd: resolve('.'),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let compilerError = '';
compiler.stderr.setEncoding('utf8');
compiler.stderr.on('data', (chunk) => { compilerError += chunk; });
const compilerExitCode = await new Promise((resolveExit) => compiler.on('close', resolveExit));
if (compilerExitCode !== 0) {
  console.error(compilerError || `TypeScript 검증 모듈 컴파일 종료 코드 ${compilerExitCode}`);
  process.exit(typeof compilerExitCode === 'number' ? compilerExitCode || 1 : 1);
}

const moduleUrl = (name) => pathToFileURL(join(temporaryDirectory, 'main', name)).href;
const runner = `
import { app, nativeImage } from 'electron';
import { readFile } from 'node:fs/promises';
import { regulationSpecies } from '@pochamp/engine';
import { VisionReferenceStore } from ${JSON.stringify(moduleUrl('vision-references.js'))};
import { analyzeWithNim } from ${JSON.stringify(moduleUrl('nim.js'))};
import { mergeLocalCandidates } from ${JSON.stringify(moduleUrl('vision-merge.js'))};
import { AppStore } from ${JSON.stringify(moduleUrl('store.js'))};

const [framePath, referenceRoot, userDataRoot, validationMode] = process.argv.slice(2);
app.disableHardwareAcceleration();
app.setPath('userData', userDataRoot);
const run = async () => {
try {
  console.error('[validate-nim] electron-started');
  const catalog = regulationSpecies().map((entry) => ({
    name: entry.name,
    displayName: entry.displayName,
    nationalDex: entry.nationalDex,
  }));
  const references = new VisionReferenceStore(referenceRoot, catalog, nativeImage);
  const frame = nativeImage.createFromBuffer(await readFile(framePath));
  const localVisionSlots = await references.matchPreview(frame);
  const inferenceSlots = validationMode === '--ai-only'
    ? localVisionSlots.map((slot) => ({ ...slot, candidates: [] }))
    : localVisionSlots;
  console.error('[validate-nim] local-matching-complete');
  const store = new AppStore();
  const settings = await store.getStoredSettings();
  if (!settings.consentAccepted) throw new Error('저장된 NVIDIA 화면 전송 동의가 없습니다.');
  const apiKey = await store.getApiKey();
  if (!apiKey) throw new Error('저장된 NVIDIA API 키가 없습니다.');
  const started = Date.now();
  console.error('[validate-nim] request-started');
  const vision = mergeLocalCandidates(await analyzeWithNim({
    apiKey,
    model: settings.model,
    imageDataUrl: frame.toDataURL(),
    slotImageDataUrls: localVisionSlots.map((slot) => slot.imageDataUrl),
    allowedSpecies: catalog.map(({ name, displayName }) => ({ name, displayName })),
    localVisionSlots: inferenceSlots,
  }), inferenceSlots);
  console.error('[validate-nim] request-complete');
  console.log(${JSON.stringify(marker)} + JSON.stringify({
    elapsedMs: Date.now() - started,
    slots: vision.opponentPreviewSlots.map((slot) => ({
      slot: slot.slot,
      species: slot.species,
      confidence: slot.confidence,
      candidates: slot.candidates,
      evidence: slot.evidence,
    })),
  }));
  app.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  app.exit(1);
}
};
void app.whenReady().then(run).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  app.exit(1);
});
`;
await writeFile(runnerPath, runner, 'utf8');

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const child = spawn(electronPath, [runnerPath, framePath, referenceRoot, userDataRoot, ...(validationMode ? [validationMode] : [])], {
  cwd: resolve('.'),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: 'false' },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});
const hardTimeout = setTimeout(() => {
  stderr += '[validate-nim] hard timeout after 60 seconds\n';
  child.kill('SIGKILL');
}, 60_000);
const exitCode = await new Promise((resolveExit) => child.on('close', resolveExit));
clearTimeout(hardTimeout);
const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(marker));
if (exitCode !== 0 || !resultLine) {
  console.error(stderr || stdout || `Electron NIM 검증 프로세스 종료 코드 ${exitCode}`);
  process.exit(typeof exitCode === 'number' ? exitCode || 1 : 1);
}

console.log(JSON.stringify(JSON.parse(resultLine.slice(marker.length)), null, 2));
