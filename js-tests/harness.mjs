// Test harness: loads assets/react-islands.js and real React 19 in Chromium.
//
// Each page comes from the fake origin https://app.test with a strict CSP
// (no inline script). This copies the Autumn default policy. The fixture
// bundles use the React development build, so React warnings show as
// console errors and fail the tests.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const LOADER = readFileSync(new URL('../assets/react-islands.js', import.meta.url), 'utf8');

export const ORIGIN = 'https://app.test';
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'";

const FIXTURES = {
  '/components.js': 'fixtures/components.jsx',
  '/late.js': 'fixtures/late.jsx',
};

let browser;
let bundles;
// With LOADER_COVERAGE set, each page records V8 block coverage.
const COVERAGE_DIR = process.env.LOADER_COVERAGE;
const covered = new Uint8Array(LOADER.length);
const pages = [];
const contexts = [];

async function bundle(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/** Starts Chromium and builds the fixture bundles. Call from `before`. */
export async function launch() {
  const entries = await Promise.all(
    Object.entries(FIXTURES).map(async ([path, entry]) => [path, await bundle(entry)]),
  );
  bundles = Object.fromEntries(entries);
  browser = await chromium.launch();
}

/** Stops Chromium and writes coverage. Call from `after`. */
export async function close() {
  if (COVERAGE_DIR) {
    for (const page of pages) {
      const entries = await page.coverage.stopJSCoverage();
      const entry = entries.find((e) => e.url.endsWith('/react-islands.js'));
      if (entry) markCovered(entry.functions);
    }
    mkdirSync(COVERAGE_DIR, { recursive: true });
    writeFileSync(`${COVERAGE_DIR}/${process.pid}.bin`, covered);
  }
  for (const context of contexts.splice(0)) await context.close();
  await browser?.close();
}

// Outer ranges first, so the innermost range sets each byte.
function markCovered(functions) {
  const ranges = functions.flatMap((f) => f.ranges);
  ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const hit = new Uint8Array(LOADER.length);
  for (const r of ranges) hit.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
  for (let i = 0; i < hit.length; i++) covered[i] |= hit[i];
}

/**
 * Opens a page with `body` HTML, the loader and the fixture bundles.
 *
 * Options:
 * - `head`: script paths in `<head>` order. Default:
 *   `['/react-islands.js', '/components.js']`. A `!` prefix loads a
 *   script without `defer`.
 * - `files`: extra map of path → JS.
 * - `init`: JS that runs before any page script (`addInitScript`).
 * - `viewport`: Playwright viewport size.
 *
 * Returns `{ page, errors, violations }`. `errors` holds uncaught page
 * errors and `console.error` texts.
 */
export async function open(body, options = {}) {
  const context = await browser.newContext(options.viewport ? { viewport: options.viewport } : {});
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  const head = options.head ?? ['/react-islands.js', '/components.js'];
  // A `!` prefix loads the script without `defer` (parser-blocking).
  const tags = [...head, '/csp-probe.js']
    .map((p) => (p.startsWith('!') ? `<script src="${p.slice(1)}"></script>` : `<script src="${p}" defer></script>`))
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8">${tags}</head><body>${body}</body></html>`;
  const files = {
    ...bundles,
    ...(options.files ?? {}),
    '/react-islands.js': LOADER,
    '/csp-probe.js': CSP_PROBE,
  };

  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (files[url.pathname] !== undefined) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: files[url.pathname] });
    }
    if (url.pathname === '/') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'content-security-policy': CSP },
        body: html,
      });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });

  if (COVERAGE_DIR) {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    pages.push(page);
  }
  await page.addInitScript(CSP_WATCH);
  if (options.init) await page.addInitScript(options.init);
  await page.goto(`${ORIGIN}/`);
  // `goto` waits for `load`. Deferred scripts and DOMContentLoaded are done.
  const { probe, violations } = await page.evaluate(() => ({
    probe: window.__cspProbe === true,
    violations: window.__cspViolations,
  }));
  if (!probe) throw new Error('same-origin scripts did not run');
  return { page, errors, violations };
}

/** Adds a same-origin script to the page and waits until it runs. */
export async function addScript(page, path) {
  await page.evaluate(
    (src) =>
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
      }),
    path,
  );
}

/** Records the `autumn:react:*` events on `document` in `window.__events`. */
export const RECORD_EVENTS = `
window.__events = [];
for (const type of ['mount', 'update', 'unmount', 'error']) {
  document.addEventListener('autumn:react:' + type, function (e) {
    window.__events.push(type + ':' + (e.detail && e.detail.name));
  });
}
`;

// Records CSP violations from the first byte of the page.
const CSP_WATCH = `
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI);
});
`;

// Loads last. It proves that same-origin scripts ran under the CSP.
const CSP_PROBE = 'window.__cspProbe = true;';
