// The loader: DOM changes (htmx swaps, moves, props updates) and strategies.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_EVENTS, close, launch, open } from './harness.mjs';

before(launch);
after(close);

const tick = (page, ms = 30) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);

test('an island that is added later mounts', async () => {
  const { page, errors } = await open('<main id="m"></main>', { init: RECORD_EVENTS });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'new';
    d.dataset.reactIsland = 'Echo';
    d.dataset.reactProps = '{"added":true}';
    document.getElementById('m').append(d);
  });
  await page.waitForSelector('#new output[data-echo]');
  assert.equal(await page.textContent('#new output'), '{"added":true}');
  assert.deepEqual(await page.evaluate(() => window.__events), ['mount:Echo']);
  assert.deepEqual(errors, []);
});

test('an htmx-style innerHTML swap unmounts old islands and mounts new ones', async () => {
  const { page, errors } = await open(
    '<main id="m"><div data-react-island="Effect" data-react-props=\'{"tag":"old"}\'>f</div></main>',
    { init: RECORD_EVENTS },
  );
  await page.waitForSelector('[data-effect]');
  await page.evaluate(() => {
    // Same steps as an htmx innerHTML swap: parse, then replace children.
    const t = document.createElement('template');
    t.innerHTML = '<div data-react-island="Effect" data-react-props=\'{"tag":"new"}\'>f</div>';
    document.getElementById('m').replaceChildren(t.content);
  });
  await page.waitForFunction(() => window.__log.includes('unmount:old') && window.__log.includes('mount:new'));
  assert.deepEqual(await page.evaluate(() => window.__log), ['mount:old', 'unmount:old', 'mount:new']);
  assert.deepEqual(await page.evaluate(() => window.__events), ['mount:Effect', 'unmount:Effect', 'mount:Effect']);
  assert.deepEqual(errors, []);
});

test('a moved island keeps its root and state', async () => {
  const { page, errors } = await open(
    '<div id="a"><div id="c" data-react-island="Counter" data-react-props=\'{"label":"Hits"}\'>f</div></div><div id="b"></div>',
  );
  await page.click('#c button');
  await page.waitForSelector('#c button:text("Hits: 1")');
  await page.evaluate(() => document.getElementById('b').append(document.getElementById('c')));
  await tick(page);
  await page.click('#b #c button');
  await page.waitForSelector('#c button:text("Hits: 2")');
  assert.deepEqual(errors, []);
});

test('a data-react-props change renders again and keeps the state', async () => {
  const { page, errors } = await open(
    '<div id="c" data-react-island="Counter" data-react-props=\'{"label":"Hits"}\'>f</div>',
    { init: RECORD_EVENTS },
  );
  await page.click('#c button');
  await page.click('#c button');
  await page.waitForSelector('#c button:text("Hits: 2")');
  await page.evaluate(() => document.getElementById('c').setAttribute('data-react-props', '{"label":"Clicks"}'));
  await page.waitForSelector('#c button:text("Clicks: 2")');
  assert.deepEqual(await page.evaluate(() => window.__events), ['mount:Counter', 'update:Counter']);
  assert.deepEqual(errors, []);
});

test('bad props on update give an error and keep the last good render', async () => {
  const { page, errors } = await open('<div id="c" data-react-island="Counter">f</div>');
  await page.click('#c button');
  await page.evaluate(() => document.getElementById('c').setAttribute('data-react-props', '[1]'));
  await page.waitForSelector('#c[data-react-state="error"]');
  assert.equal(await page.textContent('#c button'), 'Count: 1');
  assert.equal(errors.length, 1, errors.join('\n'));
});

test('a data-react-island change mounts the new component', async () => {
  const { page, errors } = await open(
    '<div id="x" data-react-island="Effect" data-react-props=\'{"tag":"a"}\'>f</div>',
    { init: RECORD_EVENTS },
  );
  await page.waitForSelector('#x [data-effect]');
  await page.evaluate(() => document.getElementById('x').setAttribute('data-react-island', 'Echo'));
  await page.waitForSelector('#x output[data-echo]');
  assert.equal(await page.textContent('#x output'), '{"tag":"a"}');
  assert.deepEqual(await page.evaluate(() => window.__log), ['mount:a', 'unmount:a']);
  assert.deepEqual(errors, []);
});

test('a restored island with stale React DOM mounts again from clean state', async () => {
  const { page, errors } = await open('<main id="m"></main>');
  await page.evaluate(() => {
    // htmx history restore puts back the old DOM, React output included.
    const t = document.createElement('template');
    t.innerHTML =
      '<div id="r" data-react-island="Counter" data-react-state="mounted"><button>Count: 9</button></div>';
    document.getElementById('m').replaceChildren(t.content);
  });
  await page.waitForSelector('#r button[data-counter]:text("Count: 0")');
  assert.equal(await page.locator('#r button').count(), 1);
  assert.deepEqual(errors, []);
});

test('the idle strategy waits for requestIdleCallback', async () => {
  const { page, errors } = await open(
    '<div id="i" data-react-island="Echo" data-react-mount="idle">wait</div>',
    {
      init: `
        window.__idle = [];
        window.requestIdleCallback = function (cb) { window.__idle.push(cb); return window.__idle.length; };
        window.cancelIdleCallback = function (id) { window.__idle[id - 1] = null; };
      `,
    },
  );
  await tick(page);
  assert.equal(await page.getAttribute('#i', 'data-react-state'), 'waiting');
  assert.equal(await page.textContent('#i'), 'wait');
  await page.evaluate(() => window.__idle.forEach((cb) => cb && cb({ timeRemaining: () => 50 })));
  await page.waitForSelector('#i output[data-echo]');
  assert.deepEqual(errors, []);
});

test('the visible strategy waits until the island is in the viewport', async () => {
  const { page, errors } = await open(
    // The CSP blocks inline styles. Text lines push the island down.
    `${'<p>line</p>'.repeat(200)}<div id="v" data-react-island="Echo" data-react-mount="visible">wait</div>`,
    { viewport: { width: 800, height: 600 } },
  );
  await tick(page, 100);
  assert.equal(await page.getAttribute('#v', 'data-react-state'), 'waiting');
  await page.evaluate(() => document.getElementById('v').scrollIntoView());
  await page.waitForSelector('#v output[data-echo]');
  assert.deepEqual(errors, []);
});

test('teardown cancels a pending trigger', async () => {
  const { page, errors } = await open(
    '<div id="i" data-react-island="Effect" data-react-mount="idle">wait</div>',
    {
      init: `
        ${RECORD_EVENTS}
        window.__idle = [];
        window.requestIdleCallback = function (cb) { window.__idle.push(cb); return window.__idle.length; };
        window.cancelIdleCallback = function (id) { window.__idle[id - 1] = null; };
      `,
    },
  );
  await tick(page);
  await page.evaluate(() => document.getElementById('i').remove());
  await tick(page);
  await page.evaluate(() => window.__idle.forEach((cb) => cb && cb({ timeRemaining: () => 50 })));
  await tick(page);
  assert.deepEqual(await page.evaluate(() => window.__log), []);
  assert.deepEqual(await page.evaluate(() => window.__events), []);
  assert.deepEqual(errors, []);
});

test('an unknown mount strategy mounts at load', async () => {
  const { page, errors } = await open('<div id="u" data-react-island="Echo" data-react-mount="later">x</div>');
  await page.waitForSelector('#u output[data-echo]');
  assert.deepEqual(errors, []);
});

test('an island removed while pending leaves no work behind', async () => {
  const { page, errors } = await open('<div id="p" data-react-island="Late">x</div>', { init: RECORD_EVENTS });
  await page.evaluate(() => document.getElementById('p').remove());
  await tick(page);
  assert.deepEqual(await page.evaluate(() => window.__events), []);
  assert.deepEqual(errors, []);
});
