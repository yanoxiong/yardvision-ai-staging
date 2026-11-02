const test = require('node:test');
const assert = require('node:assert/strict');
const { photoType, prepare, SERVER_MAX_BYTES, SOURCE_MAX_BYTES } = require('../public/mobile-photo.js');

function file(name, type, size = 2000) { return { name, type, size }; }
function environment({ width = 4032, height = 3024, outputSize = 200000, decodeFails = false } = {}) {
  let closed = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let drew = false;
  class FileStub {
    constructor(parts, name, opts) { this.size = parts[0].size; this.name = name; this.type = opts.type; }
  }
  return {
    File: FileStub,
    createImageBitmap: async () => {
      if (decodeFails) throw new Error('Unsupported image');
      return { width, height, close() { closed = true; } };
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return {
          set width(value) { canvasWidth = value; },
          set height(value) { canvasHeight = value; },
          getContext() {
            return { fillRect() {}, drawImage() { drew = true; }, set fillStyle(_) {} };
          },
          toBlob(cb, type) { cb({ size: outputSize, type }); }
        };
      }
    },
    get state() { return { closed, canvasWidth, canvasHeight, drew }; }
  };
}

test('detects HEIC by extension with empty or generic MIME', () => {
  assert.equal(photoType(file('camera.HEIC', '', 2000)), 'heic');
  assert.equal(photoType(file('camera.heif', 'application/octet-stream')), 'heic');
  assert.equal(photoType(file('camera', 'image/heic')), 'heic');
});
test('classifies original supported photo types', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(photoType(file('photo', mime)), 'native');
  }
  assert.equal(photoType(file('cat.gif', 'image/gif')), 'unsupported');
});
test('preserves small JPEG/PNG/WebP files exactly', async () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    const original = file('photo', mime);
    const result = await prepare(original, {});
    assert.equal(result.file, original);
    assert.equal(result.converted, false);
  }
});
test('converts browser-decodable HEIC to bounded JPEG with correct proportions', async () => {
  const env = environment();
  const result = await prepare(file('yard.heic', 'image/heic'), env);
  assert.equal(result.converted, true);
  assert.equal(result.file.type, 'image/jpeg');
  assert.equal(result.file.name, 'yard-photo.jpg');
  assert.ok(result.file.size <= SERVER_MAX_BYTES);
  assert.deepEqual(env.state, { closed: true, canvasWidth: 2048, canvasHeight: 1536, drew: true });
});
test('normalizes oversized native images without changing original upload limit', async () => {
  const env = environment({ width: 900, height: 1600 });
  const result = await prepare(file('huge.jpg', 'image/jpeg', SERVER_MAX_BYTES + 1), env);
  assert.equal(result.converted, true);
  assert.equal(env.state.canvasWidth, 900);
  assert.equal(env.state.canvasHeight, 1600);
});
test('rejects unknown, empty, and source-size-over-limit files', async () => {
  await assert.rejects(prepare(file('bad.gif', 'image/gif')), /Choose a JPG/);
  await assert.rejects(prepare(file('empty.jpg', 'image/jpeg', 0)), /nonempty/);
  await assert.rejects(prepare(file('huge.heic', 'image/heic', SOURCE_MAX_BYTES + 1)), /over 20 MB/);
});
test('rejects images over 40 MP and closes decoder', async () => {
  const env = environment({ width: 9000, height: 9000 });
  await assert.rejects(prepare(file('yard.heic', 'image/heic'), env), /40 megapixels/);
  assert.equal(env.state.closed, true);
});
test('falls back to browser image decoding and releases object URL', async () => {
  const env = environment({ decodeFails: true });
  const revoked = [];
  env.URL = {
    createObjectURL: () => 'blob:photo',
    revokeObjectURL(url) { revoked.push(url); }
  };
  env.Image = class {
    naturalWidth = 3000;
    naturalHeight = 4000;
    set src(_value) { queueMicrotask(() => this.onload()); }
  };
  const result = await prepare(file('yard.heic', 'image/heic'), env);
  assert.equal(result.converted, true);
  assert.equal(result.file.type, 'image/jpeg');
  assert.equal(env.state.canvasWidth, 1536);
  assert.equal(env.state.canvasHeight, 2048);
  assert.deepEqual(revoked, ['blob:photo']);
});

test('cleans up failed HTMLImageElement decode and explains HEIC fallback', async () => {
  const env = environment({ decodeFails: true });
  const revoked = [];
  env.URL = {
    createObjectURL: () => 'blob:bad',
    revokeObjectURL(url) { revoked.push(url); }
  };
  env.Image = class {
    set src(_value) { queueMicrotask(() => this.onerror()); }
  };
  await assert.rejects(prepare(file('broken.heic', 'image/heic'), env), /Export or share it as a JPEG/);
  assert.deepEqual(revoked, ['blob:bad']);
});

test('HEIC decode failure explains JPEG alternative', async () => {
  const env = environment({ decodeFails: true });
  await assert.rejects(prepare(file('yard.heic', 'image/heic'), env), /Export or share it as a JPEG/);
});
test('rejects blank or oversize JPEG output and cleans up', async () => {
  for (const outputSize of [0, SERVER_MAX_BYTES + 1]) {
    const env = environment({ outputSize });
    await assert.rejects(prepare(file('yard.heic', 'image/heic'), env), /Unable to create a safe JPEG/);
    assert.equal(env.state.closed, true);
  }
});
