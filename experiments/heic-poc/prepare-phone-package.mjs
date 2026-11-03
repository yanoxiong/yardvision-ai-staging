/* Assemble a read-only local S25 test from the exact current dev app sources.
 * No credentials, backend, private storage or customer assets are packaged.
 */
import { cp, copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('../..');
const out = resolve('phone-test-dist');
const appFiles = [
  ['public/heic-probe.js', 'heic-probe.js'],
  ['public/heic-decode.js', 'heic-decode.js'],
  ['public/mobile-photo.js', 'mobile-photo.js'],
  ['public/assets/heic-decoder.worker.js', 'assets/heic-decoder.worker.js']
];
await mkdir(out + '/assets', { recursive: true });
for (const [source, target] of appFiles) {
  await copyFile(resolve(root, source), resolve(out, target));
}
const files = [
  'index.html', 'style.css', 'phone.js', 'server.cjs',
  'START-YARDVISION-TEST.bat', 'README-WINDOWS-S25.md'
];
for (const name of files) await copyFile(resolve('phone-test', name), resolve(out, name));
await copyFile(resolve('site/sample.heic'), resolve(out, 'sample.heic'));
let licensePath = '';
for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
  try { await access(resolve('node_modules/heic-to', name)); licensePath = resolve('node_modules/heic-to', name); break; }
  catch {}
}
if (!licensePath) throw new Error('Cannot find heic-to license; do not distribute even test artifacts without it.');
await copyFile(licensePath, resolve(out, 'HEIC-TO-LICENSE.txt'));
await writeFile(resolve(out, 'TEST-BUILD.txt'), [
  'YardVision isolated HEIC S25 phone test',
  'Branch: experiment/heic-decoder-20261102',
  'Commit: ' + (process.env.GITHUB_SHA || 'locally built'),
  'heic-to dependency: 1.6.7',
  'Test only; NOT approved for production. Photo remains in browser.',
  'Full commercial decoder licensing / transitive codec notices remain open.'
].join('\n') + '\n');
const scripts = await readFile(resolve(out, 'index.html'), 'utf8');
if (!scripts.includes('/heic-decode.js') || !scripts.includes('/mobile-photo.js'))
  throw new Error('Unexpected test page source; abort packaging');
console.log('Packaged read-only local phone tester, with exact dev browser scripts.');
