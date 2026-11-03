/* YardVision client-side HEIC conversion. No file is uploaded by this module.
 * Development only: production worker CSP and nested-worker cleanup require approval.
 */
const YardVisionHeicDecoder = (() => {
  'use strict';
  const MAX_HEIC_BYTES = 10 * 1024 * 1024;
  const TIMEOUT_MS = 15000;
  const WORKER_URL = '/assets/heic-decoder.worker.js';

  async function decode(file, { signal, env = globalThis } = {}) {
    if (signal?.aborted) throw new Error('Photo selection canceled.');
    if (!file || !Number.isSafeInteger(file.size) ||
        file.size <= 0 || file.size > MAX_HEIC_BYTES) {
      throw new Error('HEIC photos must be smaller than 10 MB.');
    }
    if (!env.YardVisionHeicProbe || typeof env.YardVisionHeicProbe.probe !== 'function') {
      throw new Error('HEIC format validation is unavailable. Please use a JPG.');
    }
    await env.YardVisionHeicProbe.probe(file);
    if (signal?.aborted) throw new Error('Photo selection canceled.');
    if (typeof env.Worker !== 'function') {
      throw new Error('HEIC conversion is not available on this browser. Please use JPG.');
    }

    // The self-hosted bundle is generated during a *separately approved* build.
    let worker;
    try {
      worker = new env.Worker(WORKER_URL, { type: 'module' });
    } catch (_) {
      throw new Error('HEIC conversion cannot start here. Please use a JPG photo.');
    }

    return await new Promise((resolve, reject) => {
      let finished = false;
      let timeout;
      const abort = () => finish(new Error('Photo selection canceled.'));

      function finish(error, jpeg) {
        if (finished) return;
        finished = true;
        if (timeout !== undefined) env.clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', abort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
        if (error) reject(error);
        else resolve(jpeg);
      }

      if (signal) signal.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      worker.onerror = () => finish(new Error('HEIC conversion failed to start. Please use JPG.'));
      worker.onmessageerror = () => finish(new Error('HEIC conversion returned an unreadable result.'));
      worker.onmessage = event => {
        const message = event.data;
        if (!message || message.id !== 1) return;
        if (!message.ok) {
          return finish(new Error('Unable to convert this HEIC photo. Please use JPG.'));
        }
        const jpeg = message.jpeg;
        if (!jpeg || jpeg.type !== 'image/jpeg' ||
            !Number.isSafeInteger(jpeg.size) || jpeg.size < 1 ||
            jpeg.size > MAX_HEIC_BYTES) {
          return finish(new Error('Converted HEIC photo did not meet upload limits.'));
        }
        finish(null, jpeg);
      };

      timeout = env.setTimeout(() =>
        finish(new Error('HEIC conversion took too long. Please use JPG.')), TIMEOUT_MS);
      try {
        worker.postMessage({ op: 'decode', id: 1, blob: file });
      } catch (_) {
        finish(new Error('Unable to start HEIC conversion. Please use JPG.'));
      }
    });
  }

  return Object.freeze({ decode, MAX_HEIC_BYTES, TIMEOUT_MS });
})();

// Explicit global binding is required: top-level const is not a window property.
if (typeof globalThis !== 'undefined') globalThis.YardVisionHeicDecoder = YardVisionHeicDecoder;
if (typeof module !== 'undefined' && module.exports) module.exports = YardVisionHeicDecoder;
