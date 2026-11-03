import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const server = spawn('python3', ['-m', 'http.server', '8099', '--bind', '127.0.0.1', '--directory', 'site'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:8099/ci-test.html'); if (r.ok) { ready = true; break; } }
    catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Fixture server did not start');
  const executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome';
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error).slice(0, 250)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 250)); });
  await page.goto('http://127.0.0.1:8099/ci-test.html', {waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(() => ['PASS','FAIL'].includes(document.documentElement.dataset.test), { timeout: 26000 });
  const result = await page.evaluate(() => ({
    status: document.documentElement.dataset.test,
    detail: document.documentElement.dataset.detail,
    type: document.querySelector('#preview')?.src.startsWith('blob:') ? 'jpeg-preview' : 'no-preview'
  }));
  console.log(JSON.stringify({ ...result, errors: errors.slice(-6) }));
  if (result.status !== 'PASS' || result.type !== 'jpeg-preview') throw Error('Strict CSP HEIC browser decode did not pass');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
