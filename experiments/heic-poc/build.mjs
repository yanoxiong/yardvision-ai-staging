import { build } from 'esbuild';
await build({
  entryPoints: ['src/decoder.worker.mjs'],
  outfile: process.argv.includes('--app')
    ? '../../public/assets/heic-decoder.worker.js'
    : 'site/decoder.worker.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome110', 'safari16'],
  sourcemap: false,
  minify: false,
  logLevel: 'info'
});
console.log('Decoder bundle built for isolated testing. Do not deploy without license/security review.');
