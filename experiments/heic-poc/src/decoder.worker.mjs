/* Experiment only. HEIC decoder dependency bundled locally by esbuild. */
import { heicTo } from 'heic-to/csp';

self.onmessage = async ({ data }) => {
  if (!data || data.op !== 'decode' || !data.blob) return;
  const { id, blob } = data;
  try {
    // This library uses an internal decoding worker. Nested-worker cleanup,
    // input pixel budgets and timeouts require independent verification.
    const jpeg = await heicTo({ blob, type: 'image/jpeg', quality: 0.82 });
    if (!(jpeg instanceof Blob) || jpeg.type !== 'image/jpeg' ||
        jpeg.size < 1 || jpeg.size > 10 * 1024 * 1024) {
      throw new Error('Decoded image is invalid or too large.');
    }
    self.postMessage({ id, ok: true, jpeg });
  } catch (err) {
    self.postMessage({ id, ok: false, error: 'HEIC decoding failed on this device.',
      diagnostic: String(err?.message || err || 'unknown decoder error').slice(0, 180) });
  }
};
