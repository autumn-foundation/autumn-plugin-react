// Builds the demo island bundle with esbuild.
// Output: ../examples/islands/islands.js and islands.css (committed).
// Run: `npm run build:islands`.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await build({
  entryPoints: { islands: here('src/main.jsx') },
  outdir: here('../examples/islands'),
  bundle: true,
  // A classic script: `react_bundle` renders `<script defer>`.
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Keep the React license text in the output.
  legalComments: 'eof',
  logLevel: 'info',
});
