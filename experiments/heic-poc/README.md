# YardVision HEIC prototype — development only / HOLD

## Scope and branch
- Repository: yanoxiong/yardvision-ai-staging
- Branch: experiment/heic-decoder-20261102, based on the unmerged mobile-photo-compat PR.
- This is an **isolated proof-of-concept**, not wired into the app, and **not** a production-ready HEIC fix.
- No production, billing, session, database, storage, or existing deployment changes.
- HEIC source photos remain local to the browser; the demo makes no upload/API requests.

## Why a different decoder?
Galaxy S25 / Chrome displayed a genuine photo ending in \`.heic\`, but refused to decode it in our first offline tester. Native browser decoding is therefore insufficient.

Prototype dependency is pinned to **heic-to 1.6.7** (LGPL-3.0). The upstream package provides HEIC conversion via libheif and a worker-capable \`heic-to/next\` entry point, but it also creates its own internal Blob worker. The upstream \`heic-to/csp\` distribution avoids \`unsafe-eval\`, but its default worker module uses document/canvas and is **not the same as** \`heic-to/next\`. We have **not** verified a safe single variant with both desired properties.

## Local build/check instructions (not executed in this session due to package network restriction)
\`\`\`sh
cd experiments/heic-poc
npm install --save-exact
npm test
npm run build
cd site
python -m http.server 8080
\`\`\`
Then open \`http://localhost:8080\`. Do not access via production origin. A correct build produces \`site/decoder.worker.js\` locally. No generated vendor assets have been committed.

## Blocking gaps before a real phone test or release
1. **Vendor dependencies unavailable in this development environment** — cannot run \`npm install\` or perform genuine HEIC conversion now. Build artifact and dependency lockfile missing.
2. **CSP/worker behavior unresolved** — nested blob workers need an explicitly reviewed \`worker-src\` change, and \`heic-to/next\` may require unsafe-eval. Never weaken production \`script-src\` to accommodate a decoder. Fail closed instead.
3. **Memory limit not proved** — 10 MiB *compressed file* cap is not an output pixel/memory ceiling. The third-party decoder may allocate before dimensions are checked. The 15-second top-level timeout is best-effort, and independent confirmation of nested worker cleanup is required.
4. **Genuine HEIC fixture and mobile orientation** absent; need Samsung and iPhone test, original dimension/rotation validation, corrupt HEIC tests, and observed decode speed/battery/memory.
5. **License/legal review** of LGPL-3.0 and nested decoder/codec licenses, appropriate notices and source/offers, and build artifact checksum.
6. **End-to-end safety**: isolate from live accounts/payment paths; no merge/deployment until safe staging upload/generation tests and explicit approval.

## Tests
\`tests/probe.test.cjs\` exercises a shallow, reject-by-default HEIF \`ftyp\` brand/size check. Passing tests do not prove decoded output, resource containment, HEIC support, or compliance.

## Recommended next engineering choice
Investigate whether a **self-hosted, CSP-safe, cancellable** worker can be built using an audited libheif/codec bundle without nested uncontrolled workers. If impossible or too costly, the alternative is separately gated server-side processing isolation; never switch on unisolated native decoding just to pass mobile tests.

## References
- https://github.com/hoppergee/heic-to
- https://www.npmjs.com/package/heic-to
- Current blocked draft: https://github.com/yanoxiong/yardvision-ai-staging/pull/1
