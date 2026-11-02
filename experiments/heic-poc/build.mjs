import { build } from 'esbuild';
await build({
  entryPoints: ['src/decoder.worker.mjs'],
  outfile: 'site/decoder.worker.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome110', 'safari16'],
  sourcemap: false,
  minify: false,
  logLevel: 'info'
});
console.log('Prototype worker built locally. Do not distribute or deploy without license/security review.');
