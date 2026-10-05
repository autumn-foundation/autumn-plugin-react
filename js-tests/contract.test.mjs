// The loader against fake roots and old browsers: the edges of the contract.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_EVENTS, close, launch, open } from './harness.mjs';

before(launch);
after(close);

const tick = (page, ms = 30) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);

// A registration with fake React functions.
const FAKE = `
window.autumnReact.push({
  createElement: function (type, props) { return { type: type, props: props }; },
  createRoot: function (el) {
    if (el.id === 'no-root') throw new Error('createRoot failed');
    return {
      render: function (element) { el.textContent = 'fake:' + JSON.stringify(element.props); },
      unmount: function () { throw new Error('unmount failed'); },
    };
  },
  components: { Fake: function () {} },
});
`;

test('a createRoot error keeps the fallback and affects that island only', async () => {
  const { page, errors } = await open(
    '<div id="no-root" data-react-island="Fake">keep</div><div id="ok" data-react-island="Fake">x</div>',
    { files: { '/fake.js': FAKE }, head: ['/react-islands.js', '/fake.js'], init: RECORD_EVENTS },
  );
  await page.waitForSelector('#no-root[data-react-state="error"]');
  assert.equal(await page.textContent('#no-root'), 'keep');
  assert.equal(await page.textContent('#ok'), 'fake:{}');
  assert.deepEqual(await page.evaluate(() => window.__events), ['error:Fake', 'mount:Fake']);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /did not mount/);
});

test('an unmount error is logged and the island still goes away', async () => {
  const { page, errors } = await open('<div id="ok" data-react-island="Fake">x</div>', {
    files: { '/fake.js': FAKE },
    head: ['/react-islands.js', '/fake.js'],
    init: RECORD_EVENTS,
  });
  await page.waitForSelector('#ok[data-react-state="mounted"]');
  await page.evaluate(() => document.getElementById('ok').remove());
  await page.waitForFunction(() => window.__events.includes('unmount:Fake'));
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /did not unmount/);
});

test('without IntersectionObserver a visible island mounts at once', async () => {
  const { page, errors } = await open(
    `${'<p>line</p>'.repeat(200)}<div id="v" data-react-island="Echo" data-react-mount="visible">w</div>`,
    { init: 'delete window.IntersectionObserver;' },
  );
  await page.waitForSelector('#v output[data-echo]', { state: 'attached' });
  assert.deepEqual(errors, []);
});

test('without requestIdleCallback an idle island mounts after a timeout', async () => {
  const { page, errors } = await open('<div id="i" data-react-island="Echo" data-react-mount="idle">w</div>', {
    init: 'delete window.requestIdleCallback; delete window.cancelIdleCallback;',
  });
  await page.waitForSelector('#i output[data-echo]');
  assert.deepEqual(errors, []);
});

test('without requestIdleCallback teardown clears the timeout', async () => {
  const { page, errors } = await open(
    '<div id="i" data-react-island="Effect" data-react-mount="idle">w</div>',
    { init: `${RECORD_EVENTS} delete window.requestIdleCallback; delete window.cancelIdleCallback;` },
  );
  await page.evaluate(() => document.getElementById('i').remove());
  await tick(page, 400);
  assert.deepEqual(await page.evaluate(() => window.__events), []);
  assert.deepEqual(errors, []);
});

test('an element that gets data-react-island later mounts', async () => {
  const { page, errors } = await open('<div id="later">x</div>');
  await page.evaluate(() => {
    const el = document.getElementById('later');
    el.setAttribute('data-react-props', '{"late":1}');
    el.setAttribute('data-react-island', 'Echo');
  });
  await page.waitForSelector('#later output[data-echo]');
  assert.equal(await page.textContent('#later output'), '{"late":1}');
  assert.deepEqual(errors, []);
});

test('removing data-react-island unmounts and puts the fallback back', async () => {
  const { page, errors } = await open('<div id="x" data-react-island="Echo"><i>server</i></div>', {
    init: RECORD_EVENTS,
  });
  await page.waitForSelector('#x output[data-echo]');
  await page.evaluate(() => document.getElementById('x').removeAttribute('data-react-island'));
  await page.waitForFunction(() => window.__events.includes('unmount:Echo'));
  assert.equal(await page.innerHTML('#x'), '<i>server</i>');
  assert.deepEqual(errors, []);
});

test('an invalid selector in a props update is an error, not a crash', async () => {
  const { page, errors } = await open('<button id="b">b</button><div id="c" data-react-island="Echo">x</div>');
  await page.waitForSelector('#c output[data-echo]');
  await page.evaluate(() =>
    document.getElementById('b').dispatchEvent(
      new CustomEvent('autumn:react:props', {
        bubbles: true,
        detail: { value: [{ target: '##', props: {} }, { target: '#c', props: { ok: 1 } }] },
      }),
    ),
  );
  await page.waitForSelector('#c output:text("{\\"ok\\":1}")');
  assert.equal(errors.length, 1, errors.join('\n'));
});

test('a crashed island mounts again when it gets new props', async () => {
  const { page, errors } = await open('<div id="x" data-react-island="Boom">f</div>');
  await page.waitForSelector('#x[data-react-state="error"]');
  await page.evaluate(() => {
    const el = document.getElementById('x');
    el.setAttribute('data-react-island', 'Echo');
  });
  await page.waitForSelector('#x output[data-echo]');
  await page.evaluate(() => {
    const el = document.getElementById('x');
    el.setAttribute('data-react-island', 'Boom');
  });
  await page.waitForSelector('#x[data-react-state="error"]');
  await page.evaluate(() => {
    const el = document.getElementById('x');
    el.setAttribute('data-react-island', 'Echo');
    el.setAttribute('data-react-props', '{"again":1}');
  });
  await page.waitForSelector('#x output:text("{\\"again\\":1}")');
  assert.equal(await page.getAttribute('#x', 'data-react-state'), 'mounted');
  assert.ok(errors.every((e) => /boom/.test(e)), errors.join('\n'));
});
