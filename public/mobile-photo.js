/* Browser-only photo preparation. Nothing is sent to the server by this module. */
const YardVisionMobilePhoto = (() => {
  'use strict';

  const SERVER_MAX_BYTES = 10 * 1024 * 1024;
  const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
  const MAX_PIXELS = 40 * 1000 * 1000;
  const MAX_EDGE = 2048;
  const NATIVE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const HEIC_MIMES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

  function photoType(file) {
    const name = String(file?.name || '').toLowerCase();
    const mime = String(file?.type || '').toLowerCase();
    if (/\.(heic|heif)$/.test(name) || HEIC_MIMES.has(mime)) return 'heic';
    if (NATIVE_MIMES.has(mime) || /\.(jpe?g|png|webp)$/.test(name)) return 'native';
    return 'unsupported';
  }

  function decodeMessage(kind) {
    if (kind === 'heic') {
      return 'This browser cannot read that HEIC/HEIF photo. Export or share it as a JPEG in Photos, then try again.';
    }
    return 'This photo could not be opened. Please select a valid JPG, PNG, or WebP image.';
  }

  async function decodeForCanvas(file, env, kind) {
    if (typeof env.createImageBitmap === 'function') {
      try {
        const bitmap = await env.createImageBitmap(file, { imageOrientation: 'from-image' });
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw(ctx, width, height) { ctx.drawImage(bitmap, 0, 0, width, height); },
          cleanup() { if (typeof bitmap.close === 'function') bitmap.close(); }
        };
      } catch (_err) {
        // Some browsers can display an image even when createImageBitmap rejects it.
      }
    }

    if (typeof env.Image !== 'function' || !env.URL?.createObjectURL) {
      throw new Error(decodeMessage(kind));
    }
    const url = env.URL.createObjectURL(file);
    const image = new env.Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(decodeMessage(kind)));
        image.src = url;
      });
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        draw(ctx, width, height) { ctx.drawImage(image, 0, 0, width, height); },
        cleanup() { env.URL.revokeObjectURL(url); }
      };
    } catch (err) {
      env.URL.revokeObjectURL(url);
      throw err;
    }
  }

  async function prepare(file, env = globalThis) {
    if (!file || !Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('Choose a nonempty yard photo.');
    }
    const kind = photoType(file);
    if (kind === 'unsupported') {
      throw new Error('Choose a JPG, PNG, WebP, HEIC, or HEIF photo.');
    }
    if (file.size > SOURCE_MAX_BYTES) {
      throw new Error('This photo is over 20 MB. Please choose a smaller photo.');
    }
    // Preserve the exact previous upload behavior for existing supported files.
    if (kind === 'native' && NATIVE_MIMES.has(file.type) && file.size <= SERVER_MAX_BYTES) {
      return { file, converted: false };
    }

    const decoded = await decodeForCanvas(file, env, kind);
    try {
      const width = decoded.width;
      const height = decoded.height;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
          width < 1 || height < 1 || width * height > MAX_PIXELS) {
        throw new Error('This photo is too large to process safely. Please use a photo under 40 megapixels.');
      }
      const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      const canvas = env.document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Unable to prepare the photo on this device. Please try a JPG.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      decoded.draw(ctx, targetWidth, targetHeight);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      if (!blob || blob.type !== 'image/jpeg' || blob.size === 0 || blob.size > SERVER_MAX_BYTES) {
        throw new Error('Unable to create a safe JPEG upload. Please try a smaller photo.');
      }
      return {
        file: new env.File([blob], 'yard-photo.jpg', { type: 'image/jpeg' }),
        converted: true
      };
    } finally {
      decoded.cleanup();
    }
  }

  return { photoType, prepare, SERVER_MAX_BYTES, SOURCE_MAX_BYTES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = YardVisionMobilePhoto;
