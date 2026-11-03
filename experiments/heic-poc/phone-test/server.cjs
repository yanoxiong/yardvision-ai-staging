/* LOCAL-LAN-ONLY test server. Serves no customer endpoints or uploads.
   Stop with Ctrl+C when done. Do not port-forward this service.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = __dirname;
const PORT = 8765;
const permitted = new Set([
  '/index.html', '/style.css', '/phone.js',
  '/heic-probe.js', '/heic-decode.js', '/mobile-photo.js',
  '/assets/heic-decoder.worker.js',
  '/sample.heic'
]);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.heic': 'image/heic'
};
const csp = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' blob: data:",
  "style-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'"
].join('; ');

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {'Content-Type':'text/plain', 'Allow':'GET, HEAD'});
    return res.end('Read-only local test server');
  }
  let target;
  try { target = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Invalid request'); }
  if (target === '/') target = '/index.html';
  if (!permitted.has(target)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(ROOT, target.slice(1));
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Missing test asset'); }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('\nYardVision LOCAL PHONE TEST — no uploads, AI calls or customer accounts.');
  console.log('Open from the PC: http://localhost:' + PORT);
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(x => x.family === 'IPv4' && !x.internal)
    .map(x => x.address);
  for (const ip of new Set(ips)) console.log('Try on S25 (same Wi-Fi): http://' + ip + ':' + PORT);
  console.log('\nIf Chrome cannot connect, Windows Firewall may be blocking this port.');
  console.log('Stop the local test by closing this window or pressing Ctrl+C.\n');
});
