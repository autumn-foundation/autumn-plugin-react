// End-to-end: the real demo server, real htmx, Autumn default CSP, SRI.
//
// Build first: `cargo build --example react_demo`. Then `npm run test:e2e`.
// Set DEMO_BIN to use another binary path.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BIN = process.env.DEMO_BIN
  ?? fileURLToPath(new URL('../../target/debug/examples/react_demo', import.meta.url));
let BASE;
let server;
let browser;

// Asks the OS for a free port.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer() {
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`demo server did not start on ${BASE}`);
}

before(async () => {
  assert.ok(existsSync(BIN), `build the demo first: cargo build --example react_demo (${BIN})`);
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  server = spawn(BIN, [], {
    env: { ...process.env, AUTUMN_SERVER__PORT: String(port), AUTUMN_SERVER__HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  await waitForServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const EXPECTED_ERROR = /Broken: this component always fails/;

async function openDemo() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
    window.__events = [];
    for (const type of ['mount', 'update', 'unmount', 'error']) {
      document.addEventListener(`autumn:react:${type}`, (e) => window.__events.push(`${type}:${e.detail.name}`));
    }
  });
  const response = await page.goto(`${BASE}/`);
  await page.waitForSelector('#counter output');
  // Only the Broken island may log an error.
  const unexpected = () => errors.filter((e) => !EXPECTED_ERROR.test(e));
  return { page, response, errors, unexpected };
}

test('the page loads React islands under the default CSP with SRI', async () => {
  const { page, response, unexpected } = await openDemo();
  assert.match(response.headers()['content-security-policy'] ?? '', /script-src 'self'/);
  const state = await page.evaluate(() => ({
    violations: window.__violations,
    names: window.autumnReact.names(),
    sri: [...document.querySelectorAll('script[src*="_plugins/react"], link[href*="_plugins/react"]')].map(
      (el) => el.integrity.startsWith('sha384-'),
    ),
  }));
  assert.deepEqual(state.violations, []);
  assert.deepEqual(state.names, ['Basket', 'Broken', 'Clock', 'Counter']);
  assert.deepEqual(state.sri, [true, true, true]);
  assert.deepEqual(unexpected(), []);
});

test('the counter mounts with server props and keeps local state', async () => {
  const { page, unexpected } = await openDemo();
  assert.equal(await page.textContent('#counter output'), '3');
  await page.click('#counter button');
  assert.equal(await page.textContent('#counter output'), '4');
  assert.equal(await page.getAttribute('#counter', 'data-react-state'), 'mounted');
  assert.deepEqual(unexpected(), []);
});

test('an htmx POST sends new basket props and React keeps the open state', async () => {
  const { page, unexpected } = await openDemo();
  await page.click('#basket button');
  assert.equal(await page.getAttribute('#basket button', 'aria-expanded'), 'true');
  const before = Number((await page.textContent('#basket button')).match(/\d+/)[0]);
  await page.click('#add');
  await page.waitForSelector(`#basket button:text("Basket (${before + 1})")`);
  assert.equal(await page.getAttribute('#basket button', 'aria-expanded'), 'true', 'state kept');
  assert.equal(await page.locator('#basket li').count(), before + 1);
  assert.ok((await page.evaluate(() => window.__events)).includes('update:Basket'));
  assert.deepEqual(unexpected(), []);
});

test('htmx swaps mount and unmount the clock', async () => {
  const { page, unexpected } = await openDemo();
  await page.click('#show-clock');
  await page.waitForSelector('#clock time');
  assert.match(await page.textContent('#clock time'), /^UTC: \d\d:\d\d:\d\d$/);
  await page.click('#hide-clock');
  await page.waitForFunction(() => window.__events.includes('unmount:Clock'));
  assert.equal(await page.locator('#clock').count(), 0);
  assert.deepEqual(unexpected(), []);
});

test('a broken component shows the server fallback', async () => {
  const { page, errors } = await openDemo();
  await page.waitForSelector('#broken[data-react-state="error"]');
  assert.equal(await page.textContent('#broken'), 'Server fallback: the component failed.');
  assert.ok(errors.some((e) => EXPECTED_ERROR.test(e)), errors.join('\n'));
});

test('the visible strategy mounts on scroll', async () => {
  const { page, unexpected } = await openDemo();
  assert.equal(await page.getAttribute('#lazy', 'data-react-state'), 'waiting');
  await page.locator('#lazy').scrollIntoViewIfNeeded();
  await page.waitForSelector('#lazy output');
  assert.equal(await page.textContent('#lazy output'), '0');
  assert.deepEqual(unexpected(), []);
});
