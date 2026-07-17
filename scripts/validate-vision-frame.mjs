import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [frameArgument, referenceRootArgument, referenceMode] = process.argv.slice(2);
if (!frameArgument || !referenceRootArgument) {
  console.error('사용법: node scripts/validate-vision-frame.mjs <frame.png> <vision-reference-root> [--seed-only|--reseed]');
  process.exit(1);
}

const framePath = resolve(frameArgument);
const referenceRoot = resolve(referenceRootArgument);
const sourcePath = resolve('apps/desktop/src/main/vision-references.ts');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pochamp-vision-validation-'));
const compiledPath = join(temporaryDirectory, 'vision-references.mjs');
const tscOutputPath = join(temporaryDirectory, 'vision-references.js');
const runnerPath = join(temporaryDirectory, 'runner.mjs');
const marker = 'POCHAMP_VISION_RESULT=';
let validationReferenceRoot = referenceRoot;

if (referenceMode === '--seed-only') {
  validationReferenceRoot = join(temporaryDirectory, 'seed-only-references');
  const manifest = JSON.parse(await readFile(join(referenceRoot, 'manifest.json'), 'utf8'));
  manifest.entries = manifest.entries.filter((entry) => entry.kind === 'seed');
  await mkdir(join(validationReferenceRoot, 'seed'), { recursive: true });
  await Promise.all(manifest.entries.map(async (entry) => {
    const destination = join(validationReferenceRoot, entry.file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(referenceRoot, entry.file), destination);
  }));
  await writeFile(join(validationReferenceRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
} else if (referenceMode === '--reseed') {
  validationReferenceRoot = join(temporaryDirectory, 'reseeded-references');
  await mkdir(validationReferenceRoot, { recursive: true });
}

const require = createRequire(import.meta.url);
const compiler = spawn(process.execPath, [
  resolve('node_modules/typescript/bin/tsc'), sourcePath,
  '--module', 'nodenext', '--target', 'es2022', '--outDir', temporaryDirectory,
  '--noCheck', '--skipLibCheck',
], {
  cwd: dirname(resolve('package.json')),
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
await writeFile(compiledPath, await readFile(tscOutputPath), 'utf8');

const runner = `
import { app, nativeImage } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VisionReferenceStore } from ${JSON.stringify(pathToFileURL(compiledPath).href)};
import { regulationSpecies } from ${JSON.stringify(pathToFileURL(resolve('packages/engine/dist/index.js')).href)};

const [framePath, referenceRoot] = process.argv.slice(2);
app.disableHardwareAcceleration();
try {
  const reseed = ${JSON.stringify(referenceMode === '--reseed')};
  const manifest = reseed ? null : JSON.parse(await readFile(join(referenceRoot, 'manifest.json'), 'utf8'));
  const species = reseed
    ? regulationSpecies().map((entry) => ({ name: entry.name, displayName: entry.displayName, nationalDex: entry.nationalDex }))
    : [...new Set(manifest.entries.map((entry) => entry.species))].map((name) => ({ name, displayName: name, nationalDex: 0 }));
  const store = new VisionReferenceStore(referenceRoot, species, nativeImage);
  if (reseed) await store.seed();
  const frame = nativeImage.createFromBuffer(await readFile(framePath));
  const result = await store.matchPreview(frame);
  console.log(${JSON.stringify(marker)} + JSON.stringify(result.map((slot) => ({
    slot: slot.slot,
    candidates: slot.candidates,
  }))));
  app.exit(0);
} catch (error) {
  console.error(error);
  app.exit(1);
}
`;
await writeFile(runnerPath, runner, 'utf8');

const electronPath = require('electron');
const child = spawn(electronPath, [runnerPath, framePath, validationReferenceRoot], {
  cwd: dirname(resolve('package.json')),
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: 'false' },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });
const exitCode = await new Promise((resolveExit) => child.on('close', resolveExit));
const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(marker));
if (exitCode !== 0 || !resultLine) {
  console.error(stderr || stdout || `Electron 검증 프로세스 종료 코드 ${exitCode}`);
  process.exit(typeof exitCode === 'number' ? exitCode || 1 : 1);
}

console.log(JSON.stringify(JSON.parse(resultLine.slice(marker.length)), null, 2));
