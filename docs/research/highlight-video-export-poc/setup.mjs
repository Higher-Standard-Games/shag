// Research dependency only. No npm install or project lockfile changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cache = path.join(root, '.cache/highlight-video-export-poc');
const version = '1.62.1';
const integrity = 'lYzeerDwo9QLhBCipqQDXOSV7InvaIFplllZQviPO5rPwH+IUr8M1uvumk1olIUgMRGkPiInRriv25WFErUgMw==';
await fs.mkdir(cache, { recursive: true });
const response = await fetch(`https://registry.npmjs.org/mediabunny/-/mediabunny-${version}.tgz`);
if (!response.ok) throw new Error(`Package HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha512').update(bytes).digest('base64') !== integrity) throw new Error('Package integrity mismatch');
const archive = path.join(cache, `mediabunny-${version}.tgz`);
await fs.writeFile(archive, bytes);
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
if (entries.some(entry => !entry.startsWith('package/') || entry.split('/').includes('..'))) throw new Error('Unsafe package path');
const destination = path.join(cache, `mediabunny-${version}`);
await fs.mkdir(destination, { recursive: true });
execFileSync('tar', ['-xzf', archive, '--strip-components', '1', '-C', destination]);
await fs.writeFile(path.join(cache, 'dependency.json'), JSON.stringify({ name: 'mediabunny', version, integrity: `sha512-${integrity}`, source: response.url, license: 'MPL-2.0' }, null, 2));
console.log(JSON.stringify({ destination, bundles: entries.filter(entry => entry.startsWith('package/dist/bundles/')) }));
