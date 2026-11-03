/* Isolated experiment: bounded HEIC header probing, not a full decoder. */
(function (root) {
  'use strict';
  const MAX_INPUT = 10 * 1024 * 1024;
  const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
  const HEADER_SIZE = 64;
  function brand(bytes, offset) {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
  }
  async function probe(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 ||
        file.size > MAX_INPUT || typeof file.slice !== 'function') {
      throw new Error('Choose a HEIC photo smaller than 10 MB.');
    }
    const buf = await file.slice(0, HEADER_SIZE).arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length < 16 || brand(bytes, 4) !== 'ftyp') {
      throw new Error('The selected file is not a recognized HEIC container.');
    }
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size < 16 || size > bytes.length || size > file.size || (size - 16) % 4 !== 0) {
      throw new Error('This HEIC file has an invalid or unsupported file header.');
    }
    const brands = [brand(bytes, 8)];
    for (let i = 16; i < size; i += 4) brands.push(brand(bytes, i));
    if (!brands.some(b => HEIC_BRANDS.has(b))) {
      throw new Error('This is not a supported HEIC-encoded image.');
    }
    return { size: file.size, brands };
  }
  const api = Object.freeze({ probe, MAX_INPUT });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.YardVisionHeicProbe = api;
})(typeof globalThis !== 'undefined' ? globalThis : null);
