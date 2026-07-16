import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const rootPackage = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const releaseDirectory = resolve('apps/desktop/release');
const metadata = await readFile(resolve(releaseDirectory, 'latest.yml'), 'utf8');
const metadataVersion = /^version: (.+)$/m.exec(metadata)?.[1];
const fileName = /^  - url: (.+)$/m.exec(metadata)?.[1];
const expectedHash = /^    sha512: (.+)$/m.exec(metadata)?.[1];
const expectedSize = Number(/^    size: (\d+)$/m.exec(metadata)?.[1]);

if (!metadataVersion || !fileName || !expectedHash || !expectedSize) throw new Error('latest.yml 필수 필드를 읽지 못했습니다.');
if (metadataVersion !== rootPackage.version) throw new Error(`버전 불일치: package=${rootPackage.version}, latest.yml=${metadataVersion}`);

const installerPath = resolve(releaseDirectory, fileName);
const installer = await readFile(installerPath);
const actualHash = createHash('sha512').update(installer).digest('base64');
const actualSize = (await stat(installerPath)).size;
if (actualHash !== expectedHash) throw new Error('설치 파일의 SHA-512가 latest.yml과 다릅니다.');
if (actualSize !== expectedSize) throw new Error('설치 파일 크기가 latest.yml과 다릅니다.');

const preloadBundle = await readFile(resolve('apps/desktop/out/preload/index.cjs'), 'utf8');
const mainBundle = await readFile(resolve('apps/desktop/out/main/index.js'), 'utf8');
if (!preloadBundle.includes('require("electron")')) throw new Error('sandbox preload가 CommonJS Electron import를 사용하지 않습니다.');
if (!mainBundle.includes('../preload/index.cjs')) throw new Error('main process가 CommonJS preload를 참조하지 않습니다.');

console.log(JSON.stringify({ version: metadataVersion, fileName, size: actualSize, sha512Matches: true, sandboxPreload: 'commonjs' }, null, 2));
