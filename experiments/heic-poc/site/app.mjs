/* Single-file offline-preserving demo, requires localhost HTTP and bundled worker. */
const el = id => document.getElementById(id);
const input = el('file');
const status = el('status');
const preview = el('preview');
const download = el('download');
const MAX_TIME_MS = 15000;
let url = null;
let active = null;
let generation = 0;
function show(message, good = false) {
  status.textContent = message;
  status.dataset.result = good ? 'ok' : 'no';
}
function cleanup() {
  if (active) { active.terminate(); active = null; }
  if (url) { URL.revokeObjectURL(url); url = null; }
  preview.removeAttribute('src');
  preview.hidden = true;
  download.hidden = true;
  download.removeAttribute('href');
}
function decode(file, token) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./decoder.worker.js', import.meta.url), { type: 'module' });
    active = worker;
    let settled = false;
    function settle(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      if (active === worker) active = null;
      if (error) reject(error); else resolve(value);
    }
    const timeout = setTimeout(() => settle(new Error('Decoder timed out. Please use a JPG photo.')), MAX_TIME_MS);
    worker.onerror = () => settle(new Error('Decoder failed to start. Please use JPG.'));
    worker.onmessage = ev => {
      const msg = ev.data;
      if (!msg || msg.id !== token) return;
      if (msg.ok && msg.jpeg instanceof Blob) settle(null, msg.jpeg);
      else settle(new Error(msg.error || 'HEIC decoding failed.'));
    };
    try { worker.postMessage({ op: 'decode', id: token, blob: file }); }
    catch (_) { settle(new Error('Unable to send HEIC photo for decoding.')); }
  });
}
input.onchange = async () => {
  const file = input.files && input.files[0];
  const token = ++generation;
  cleanup();
  if (!file) { show('Choose a photo.'); return; }
  show('Checking HEIC header and size locally…');
  try {
    await YardVisionHeicProbe.probe(file);
    if (token !== generation) return;
    show('Decoding HEIC locally. This may be slow on some phones…');
    const jpeg = await decode(file, token);
    if (token !== generation) return;
    if (jpeg.type !== 'image/jpeg' || jpeg.size > 10 * 1024 * 1024 || jpeg.size === 0)
      throw new Error('Converted image did not meet the JPEG upload limits.');
    url = URL.createObjectURL(jpeg);
    preview.src = url;
    preview.hidden = false;
    download.href = url;
    download.download = 'yardvision-heic-prototype.jpg';
    download.hidden = false;
    show('Decoder returned a JPEG. Check that the preview is upright and recognizable.', true);
  } catch (err) {
    if (token === generation) show(err?.message || 'Unsupported HEIC. Please share it as JPG.');
  }
};
window.addEventListener('pagehide', () => { generation++; cleanup(); });
