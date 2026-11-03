/* CI-only, runs actual YardVision front-end with a genuine HEIC fixture.
 * Served from a temporary local static origin. No API keys, accounts or AI calls.
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const site = resolve('../../public');
const testPage = resolve(site, '__ci_photo_integration.html');
const sample = resolve(site, '__ci_sample.heic');
const sourceHtml = await readFile(resolve(site, 'index.html'), 'utf8');
const policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'\">";
if (!sourceHtml.includes('<head>')) throw new Error('Could not add CI CSP to YardVision index.html');
let browser, server;
try {
  await writeFile(testPage, sourceHtml.replace('<head>', '<head>' + policy));
  await copyFile(resolve('site/sample.heic'), sample);
  server = spawn('python3', ['-m', 'http.server', '8103', '--bind', '127.0.0.1', '--directory', site], { stdio: 'ignore' });
  let ready = false;
  for (let i=0; i<40; i++) {
    try { const response = await fetch('http://127.0.0.1:8103/__ci_photo_integration.html'); if (response.ok) {ready = true; break;} }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Static test origin unavailable');

  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && /Content Security Policy|Refused to|Uncaught/.test(msg.text())) errors.push(msg.text());
  });
  await page.goto('http://127.0.0.1:8103/__ci_photo_integration.html', { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.waitForFunction(() =>
    typeof YardVisionMobilePhoto !== 'undefined' &&
    typeof YardVisionHeicDecoder !== 'undefined' &&
    document.getElementById('yardFile') !== null,
    { timeout: 12000 });

  async function waitForStatus() {
    await page.waitForFunction(() => {
      const s = document.getElementById('photoStatus').textContent;
      return /ready to design|could not|unavailable|not recognized|invalid|unsupported|too large|canceled|please use JPG/i.test(s);
    }, { timeout: 27000 });
    return page.evaluate(async () => {
      const preview = document.getElementById('uploadPreview');
      if (!preview.classList.contains('hidden')) {
        try { await preview.decode(); } catch {}
      }
      const bytes = currentFile ? [...new Uint8Array(await currentFile.slice(0,3).arrayBuffer())] : [];
      return {
        status: document.getElementById('photoStatus').textContent,
        type: currentFile?.type || null,
        size: currentFile?.size || 0,
        name: currentFile?.name || null,
        previewWidth: preview.naturalWidth,
        previewHeight: preview.naturalHeight,
        previewHidden: preview.classList.contains('hidden'),
        generateDisabled: document.getElementById('generateBtn').disabled,
        signature: bytes
      };
    });
  }
  async function chooseFixture() {
    await page.evaluate(async () => {
      const response = await fetch('/__ci_sample.heic');
      const blob = await response.blob();
      const input = document.getElementById('yardFile');
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'real-heic-fixture.heic', {type:'image/heic'}));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles:true }));
    });
  }
  async function chooseCanvas(type) {
    await page.evaluate(async type => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#36796f'; ctx.fillRect(0,0,320,200);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .9));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], type==='image/png' ? 'yard.png' : 'yard.jpg', {type}));
      const input = document.getElementById('yardFile');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles:true }));
    }, type);
  }

  await chooseFixture();
  const heic = await waitForStatus();
  if (heic.type !== 'image/jpeg' || heic.previewHidden ||
      heic.previewWidth !== 640 || heic.previewHeight !== 480 ||
      heic.signature[0] !== 255 || heic.signature[1] !== 216 ||
      heic.generateDisabled || errors.length) {
    throw new Error('HEIC integration failed: '+JSON.stringify({heic,errors}));
  }
  console.log('YardVision real HEIC -> JPEG integration PASS:',JSON.stringify(heic));

  for (const type of ['image/png','image/jpeg']) {
    await chooseCanvas(type);
    const result=await waitForStatus();
    if (result.type !== type || result.previewHidden ||
        result.previewWidth !== 320 || result.previewHeight !== 200 ||
        result.generateDisabled || errors.length) {
      throw new Error('Native photo regression failed: '+JSON.stringify({type,result,errors}));
    }
    console.log('YardVision native photo regression PASS:',type);
  }

  await page.evaluate(() => {
    const bad = new File([new Uint8Array(128)],'broken.heic',{type:'image/heic'});
    const transfer = new DataTransfer(); transfer.items.add(bad);
    const input = document.getElementById('yardFile');
    input.files=transfer.files;
    input.dispatchEvent(new Event('change', { bubbles:true }));
  });
  const bad=await waitForStatus();
  if (bad.type !== null || !bad.previewHidden || !/not recognized|invalid|unsupported/i.test(bad.status)) {
    throw new Error('Corrupt HEIC failure path did not fail closed: '+JSON.stringify(bad));
  }
  console.log('YardVision corrupt HEIC rejection PASS');
  if (errors.length) throw new Error('Browser CSP/runtime errors: '+JSON.stringify(errors));
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  await rm(testPage, { force:true });
  await rm(sample, { force:true });
}
