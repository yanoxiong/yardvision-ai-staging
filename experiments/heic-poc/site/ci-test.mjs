// CI-only: decode one CC0 sample using EXACT same page script and CSP.
const fileInput = document.getElementById('file');
const status = document.getElementById('status');
document.documentElement.dataset.test = 'RUNNING';
(async () => {
  try {
    const result = await fetch('./sample.heic', { cache: 'no-store' });
    if (!result.ok) throw new Error('HEIC fixture unavailable');
    const bytes = await result.blob();
    if (bytes.size < 100 || bytes.size > 20000) throw new Error('HEIC fixture wrong size');
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'sample.heic', { type: 'image/heic' }));
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change'));
    let passed = false;
    for (let i = 0; i < 200; i++) {
      await new Promise(resolve => setTimeout(resolve, 80));
      if (status.dataset.result === 'ok' &&
          document.getElementById('preview').src.startsWith('blob:')) {
        passed = true; break;
      }
      if (status.dataset.result === 'no' && /failed|timed out|invalid|unsupported|not recognized|too large/i.test(status.textContent)) break;
    }
    document.documentElement.dataset.test = passed ? 'PASS' : 'FAIL';
    document.documentElement.dataset.detail = status.textContent.slice(0, 120);
  } catch (err) {
    document.documentElement.dataset.test = 'FAIL';
    document.documentElement.dataset.detail = String(err.message || err).slice(0, 120);
  }
})();
