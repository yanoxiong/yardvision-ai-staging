const test = require('node:test');
const assert = require('node:assert/strict');
const { decode, MAX_HEIC_BYTES } = require('../public/heic-decode.js');

function mockEnv({ probeFails = false, behavior = 'success' } = {}) {
  const created = [];
  class WorkerMock {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.terminated = false;
      created.push(this);
    }
    postMessage(message) {
      this.posted = message;
      queueMicrotask(() => {
        if (this.terminated) return;
        if (behavior === 'success') this.onmessage({ data: { id: 1, ok: true, jpeg: { type:'image/jpeg', size:120000 } } });
        if (behavior === 'refusal') this.onmessage({ data: { id: 1, ok: false } });
        if (behavior === 'bad-result') this.onmessage({ data: { id: 1, ok: true, jpeg: { type:'image/heic', size:120000 } } });
        if (behavior === 'error') this.onerror();
        if (behavior === 'unreadable') this.onmessageerror();
      });
    }
    terminate() { this.terminated = true; }
  }
  return {
    Worker: WorkerMock,
    YardVisionHeicProbe: { async probe() { if (probeFails) throw new Error('Header rejected'); return { brands:['heic'] }; } },
    setTimeout, clearTimeout,
    get workers() { return created; }
  };
}
const heic = { name:'camera.heic', type:'image/heic', size:2500 };

test('converts valid HEIC via same-origin module worker, and terminates it', async () => {
  const env=mockEnv();
  const jpeg=await decode(heic,{env});
  assert.equal(jpeg.type,'image/jpeg');
  assert.equal(env.workers.length,1);
  assert.equal(env.workers[0].url,'/assets/heic-decoder.worker.js');
  assert.deepEqual(env.workers[0].options,{type:'module'});
  assert.equal(env.workers[0].posted.blob,heic);
  assert.equal(env.workers[0].terminated,true);
});
test('rejects invalid size before header probing or worker creation', async () => {
  const env=mockEnv();
  await assert.rejects(decode({...heic,size:MAX_HEIC_BYTES+1},{env}), /smaller than 10 MB/);
  await assert.rejects(decode({...heic,size:0},{env}), /smaller than 10 MB/);
  assert.equal(env.workers.length,0);
});
test('rejects forged or corrupt HEIC before worker creation', async () => {
  const env=mockEnv({probeFails:true});
  await assert.rejects(decode(heic,{env}),/Header rejected/);
  assert.equal(env.workers.length,0);
});
for(const behavior of ['refusal','bad-result','error','unreadable']) {
  test('terminates worker on '+behavior, async () => {
    const env=mockEnv({behavior});
    await assert.rejects(decode(heic,{env}),/HEIC|Converted/);
    assert.equal(env.workers.length,1);
    assert.equal(env.workers[0].terminated,true);
  });
}
test('canceled selection terminates worker and rejects', async () => {
  const env=mockEnv({behavior:'wait'});
  const controller=new AbortController();
  const promise=decode(heic,{env,signal:controller.signal});
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(promise,/selection canceled/);
  assert.equal(env.workers[0].terminated,true);
});
test('already canceled HEIC never starts worker', async () => {
  const env=mockEnv();
  const controller=new AbortController(); controller.abort();
  await assert.rejects(decode(heic,{env,signal:controller.signal}),/selection canceled/);
  assert.equal(env.workers.length,0);
});
test('unavailable Worker fails clearly without uploading', async () => {
  const env=mockEnv(); delete env.Worker;
  await assert.rejects(decode(heic,{env}),/not available on this browser/);
});
test('silent worker expires through bounded timer and terminates', async () => {
  const env=mockEnv({behavior:'wait'});
  env.setTimeout = fn => { queueMicrotask(fn); return 99; };
  env.clearTimeout = () => {};
  await assert.rejects(decode(heic,{env}),/took too long/);
  assert.equal(env.workers[0].terminated,true);
});
