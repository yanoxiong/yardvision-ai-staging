/* Standalone local S25 acceptance page; uses identical GitHub development helper scripts. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const input = el('yardFile');
  const status = el('status');
  const details = el('details');
  const preview = el('preview');
  const save = el('save');
  let controller = null;
  let objectUrl = null;
  let sequence = 0;

  const show = (message, result = '') => {
    status.textContent = message;
    status.dataset.result = result;
  };
  const reset = () => {
    if (controller) controller.abort();
    controller = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    details.textContent = '';
    preview.hidden = true;
    preview.removeAttribute('src');
    save.hidden = true;
    save.removeAttribute('href');
  };
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    const id = ++sequence;
    reset();
    if (!file) { show('Choose a photo to begin.'); return; }
    input.value = '';
    controller = new AbortController();
    show('Preparing photo locally on this phone…');
    try {
      const prepared = await YardVisionMobilePhoto.prepare(file, globalThis, { signal: controller.signal });
      if (id !== sequence || controller.signal.aborted) return;
      const output = prepared.file;
      if (!output || output.size < 1 || output.size > 10 * 1024 * 1024 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(output.type)) {
        throw new Error('Processed photo does not meet YardVision upload requirements.');
      }
      if (prepared.converted) {
        const bytes = new Uint8Array(await output.slice(0, 3).arrayBuffer());
        if (bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) {
          throw new Error('Converted file does not contain valid JPEG header bytes.');
        }
      }
      if (id !== sequence || controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(output);
      preview.src = objectUrl;
      await preview.decode();
      if (id !== sequence || controller.signal.aborted) return;
      if (preview.naturalWidth < 1 || preview.naturalHeight < 1) {
        throw new Error('Preview dimensions are invalid.');
      }
      preview.hidden = false;
      save.href = objectUrl;
      save.download = output.name || 'yardvision-photo.jpg';
      save.hidden = false;
      details.textContent =
        'Input: ' + file.name + ' · ' + (file.size / 1048576).toFixed(2) + ' MiB' +
        '\nOutput: ' + output.type + ' · ' + (output.size / 1048576).toFixed(2) + ' MiB' +
        '\nDimensions: ' + preview.naturalWidth + ' × ' + preview.naturalHeight +
        '\nConverted: ' + (prepared.converted ? 'Yes' : 'No');
      show('PASS — YardVision prepared a supported image locally. Check that the preview looks upright.', 'pass');
    } catch (err) {
      if (id !== sequence) return;
      show('FAIL — ' + (err?.message || 'Unable to process this photo.'), 'fail');
    }
  });
  window.addEventListener('pagehide', () => { ++sequence; reset(); });
})();
