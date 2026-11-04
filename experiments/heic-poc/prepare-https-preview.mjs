/* Build a standalone HTTPS preview of YardVision's existing browser photo path.
 * Isolated from Render, customer accounts, API keys, billing and AI generation.
 * Pages is PUBLIC. Do not put any real customer files in this output.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = resolve('phone-test-dist');
const output = resolve('https-preview-dist');
await mkdir(output+'/assets',{recursive:true});
for (const filename of ['style.css','phone.js','heic-probe.js','mobile-photo.js',
    'HEIC-TO-LICENSE.txt','sample.heic','TEST-BUILD.txt']) {
  await copyFile(resolve(source,filename),resolve(output,filename));
}
await copyFile(resolve(source,'assets/heic-decoder.worker.js'),resolve(output,'assets/heic-decoder.worker.js'));
let helper = await readFile(resolve(source,'heic-decode.js'),'utf8');
const absoluteWorker = "'/assets/heic-decoder.worker.js'";
if (!helper.includes(absoluteWorker)) throw Error('Unexpected worker URL; abort HTTPS packaging');
helper=helper.replace(absoluteWorker,"'./assets/heic-decoder.worker.js'");
await writeFile(resolve(output,'heic-decode.js'),helper);

let html=await readFile(resolve(source,'index.html'),'utf8');
const paths = ['style.css','heic-probe.js','heic-decode.js','mobile-photo.js','phone.js'];
for (const f of paths) {
  const old='="/'+f+'"', value='="./'+f+'"';
  if (!html.includes(old)) throw Error('Missing '+f+' path for Pages');
  html=html.replace(old,value);
}
const csp = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' blob: data:",
  "style-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'"
].join('; ');
html = html.replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">\n'+
  '<meta http-equiv="Content-Security-Policy" content="'+csp+'">');
html=html.replace('YARDVISION AI · LOCAL TEST ONLY','YARDVISION AI · HTTPS STAGING PHOTO TEST');
html=html.replace('This test does not generate AI designs, sign into accounts, contact payment systems, or upload photos. The test server temporarily permits dynamic code evaluation <strong>inside its isolated decoder worker only</strong>; that exception is <strong>not allowed for production</strong>.',
 'This page is a publicly reachable <strong>test only</strong>: no AI design, accounts, payments, or photo upload. The library uses dynamic code evaluation inside its decoder worker; production CSP safety is <strong>not approved</strong>. Please select only a non-sensitive photo.');
await writeFile(resolve(output,'index.html'),html);
await writeFile(resolve(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
await writeFile(resolve(output,'.nojekyll'),'');
await writeFile(resolve(output,'README-TEST-ONLY.txt'),[
  'YardVision / HTTPS browser photo acceptance preview only',
  'For the Galaxy S25 HEIC photo test. PUBLIC web page; no authentication.',
  'Uses an exact source copy of development mobile photo normalization.',
  'No uploads or API calls, accounts, designs or payments.',
  'Decoder generated from heic-to@1.6.7 (LGPL-3.0).',
  'Static hosting does not add a restrictive worker CSP response,',
  'thus the current decoder worker has no production-approved CSP restriction.',
  'Main test page does block unsafe-eval and remote network calls.',
  'Development, not approved for commercial/customer deployment.',
  'Decoder licensing, nested worker resource limits, production CSP remain OPEN.',
  'Repository: https://github.com/yanoxiong/yardvision-ai-staging'
].join('\n')+'\n');
console.log('Created HTTPS Pages preview, no backend or production assets.');
