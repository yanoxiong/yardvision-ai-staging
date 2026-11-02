const test = require('node:test');
const assert = require('node:assert/strict');
const { probe, MAX_INPUT } = require('../site/probe.js');

function make(major = 'heic', compatible = ['mif1'], opts = {}) {
  const count = compatible.length;
  const size = 16 + 4 * count;
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(opts.boxSize === undefined ? size : opts.boxSize, 0);
  bytes.write(opts.badBox ? 'nope' : 'ftyp', 4);
  bytes.write(major, 8);
  for (let i = 0; i < count; i++) bytes.write(compatible[i], 16 + i * 4);
  return { name: 'sample.heic', size: opts.fileSize || bytes.length,
    slice: () => ({ arrayBuffer: async () => Uint8Array.from(bytes).buffer }) };
}
test('accepts HEIC major brand and compatible HEIC brands', async () => {
  assert.equal((await probe(make())).brands[0], 'heic');
  assert.ok((await probe(make('mif1', ['heic']))).brands.includes('heic'));
});
test('rejects AVIF disguised as HEIC without HEIC compatible brands', async () => {
  await assert.rejects(probe(make('avif', ['mif1'])), /not a supported HEIC/);
});
test('rejects arbitrary unrecognized or broken container header', async () => {
  await assert.rejects(probe(make('heic', ['mif1'], { badBox: true })), /not a recognized HEIC/);
  await assert.rejects(probe(make('heic', ['mif1'], { boxSize: 9 })), /invalid or unsupported/);
  await assert.rejects(probe(make('heic', ['mif1'], { boxSize: 4096 })), /invalid or unsupported/);
});
test('rejects empty and oversized inputs before reading', async () => {
  const empty = make(); empty.size = 0;
  await assert.rejects(probe(empty), /smaller than 10 MB/);
  const giant = make(); giant.size = MAX_INPUT + 1;
  giant.slice = () => { throw Error('Must reject before reading'); };
  await assert.rejects(probe(giant), /smaller than 10 MB/);
});
test('rejects generic input with no slice function', async () => {
  await assert.rejects(probe({name:'fake.heic', size:50}), /smaller than 10 MB/);
});
