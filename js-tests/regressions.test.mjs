// Regression tests for the review findings (loader lifecycle and safety).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_EVENTS, close, launch, open } from './harness.mjs';

before(launch);
after(close);

const tick = (page, ms = 30) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
const events = (page) => page.evaluate(() => window.__events);
const log = (page) => page.evaluate(() => window.__log);

test('a nested island in a mounted island fallback never mounts', async () => {
  const { page, errors } = await open(
    '<div id="o" data-react-island="Counter"><div data-react-island="Effect" data-react-props=\'{"tag":"ghost"}\'>i</div></div>',
    // The bundle runs first, so the outer island mounts during the scan.
    { init: RECORD_EVENTS, head: ['/components.js', '/react-islands.js'] },
  );
  await page.waitForSelector('#o button[data-counter]');
  await tick(page);
  assert.deepEqual(await log(page), []);
  assert.deepEqual(await events(page), ['mount:Counter']);
  assert.deepEqual(errors, []);
});

test('an island added and removed in one task never mounts', async () => {
  const { page, errors } = await open('<main id="m"></main>', { init: RECORD_EVENTS });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.dataset.reactIsland = 'Effect';
    d.dataset.reactProps = '{"tag":"ghost"}';
    document.getElementById('m').append(d);
    d.remove();
  });
  await tick(page);
  assert.deepEqual(await log(page), []);
  assert.deepEqual(await events(page), []);
  assert.deepEqual(errors, []);
});

test('new props and a swap of the same region in one task leave no ghost root', async () => {
  const { page, errors } = await open(
    '<main id="m"><div id="x" data-react-island="Effect" data-react-props=\'{"tag":"old"}\'>f</div></main>',
    { init: RECORD_EVENTS },
  );
  await page.waitForSelector('#x [data-effect]');
  await page.evaluate(() => {
    // htmx handles HX-Trigger, then swaps, in one task.
    document.getElementById('x').setAttribute('data-react-props', '{"tag":"ghost"}');
    const t = document.createElement('template');
    t.innerHTML = '<div id="x" data-react-island="Effect" data-react-props=\'{"tag":"new"}\'>f</div>';
    document.getElementById('m').replaceChildren(t.content);
  });
  await page.waitForFunction(() => window.__log.includes('mount:new'));
  await tick(page);
  assert.deepEqual(await log(page), ['mount:old', 'unmount:old', 'mount:new']);
  assert.deepEqual(await events(page), ['mount:Effect', 'unmount:Effect', 'mount:Effect']);
  assert.deepEqual(errors, []);
});

test('an island detached and attached again keeps its fallback', async () => {
  const { page } = await open('<main id="m"><div id="x" data-react-island="Echo"><i>f</i></div></main>');
  await page.waitForSelector('#x output');
  await page.evaluate(() => {
    window.__held = document.getElementById('x');
    window.__held.remove();
  });
  await tick(page);
  assert.equal(await page.evaluate(() => window.__held.innerHTML), '<i>f</i>');
  await page.evaluate(() => document.getElementById('m').append(window.__held));
  await page.waitForSelector('#x output');
  await page.evaluate(() => document.getElementById('x').setAttribute('data-react-island', 'Boom'));
  await page.waitForSelector('#x[data-react-state="error"]');
  assert.equal(await page.innerHTML('#x'), '<i>f</i>');
});

test('with flushSync the mount and update events fire after React commits', async () => {
  const { page, errors } = await open('<div id="c" data-react-island="Counter">f</div>', {
    init: `
      window.__seen = [];
      document.addEventListener('autumn:react:mount', (e) => window.__seen.push(e.detail.element.textContent));
      document.addEventListener('autumn:react:update', (e) => window.__seen.push(e.detail.element.textContent));
    `,
  });
  await page.waitForSelector('#c button');
  await page.evaluate(() => document.getElementById('c').setAttribute('data-react-props', '{"label":"New"}'));
  await page.waitForFunction(() => window.__seen.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__seen), ['Count: 0', 'New: 0']);
  assert.deepEqual(errors, []);
});

test('a crash on the first render sends error and no mount event', async () => {
  const { page } = await open('<div id="b" data-react-island="Boom">f</div>', { init: RECORD_EVENTS });
  await page.waitForSelector('#b[data-react-state="error"]');
  await tick(page);
  assert.deepEqual(await events(page), ['error:Boom']);
});

test('an island moved into data-react-ignore unmounts and gets its fallback back', async () => {
  const { page, errors } = await open(
    '<section id="s" data-react-ignore></section><div id="x" data-react-island="Effect"><i>f</i></div>',
    { init: RECORD_EVENTS },
  );
  await page.waitForSelector('#x [data-effect]');
  await page.evaluate(() => document.getElementById('s').append(document.getElementById('x')));
  await page.waitForFunction(() => window.__log.includes('unmount:x'));
  assert.equal(await page.innerHTML('#x'), '<i>f</i>');
  assert.deepEqual(errors, []);
});

test('an ancestor that becomes an island unmounts the island inside it', async () => {
  const { page, errors } = await open(
    '<div id="a"><div id="x" data-react-island="Effect" data-react-props=\'{"tag":"inner"}\'>f</div></div>',
    { init: RECORD_EVENTS },
  );
  await page.waitForSelector('#x [data-effect]');
  await page.evaluate(() => document.getElementById('a').setAttribute('data-react-island', 'Echo'));
  await page.waitForSelector('#a output[data-echo]');
  await page.waitForFunction(() => window.__log.includes('unmount:inner'));
  assert.deepEqual(errors, []);
});

test('stale React DOM from a history restore is not kept as the fallback', async () => {
  const { page, errors } = await open('<main id="m"></main>');
  await page.evaluate(() => {
    const t = document.createElement('template');
    t.innerHTML = '<div id="r" data-react-island="Late" data-react-state="mounted"><button>Count: 9</button></div>';
    document.getElementById('m').replaceChildren(t.content);
  });
  // The island is empty, so it is not visible.
  await page.waitForSelector('#r[data-react-state="pending"]', { state: 'attached' });
  assert.equal(await page.locator('#r button').count(), 0);
  assert.deepEqual(errors, []);
});

test('removing data-react-island from a pending island mounts the islands in it', async () => {
  const { page, errors } = await open(
    '<div id="o" data-react-island="Missing"><div id="in" data-react-island="Echo">i</div></div>',
  );
  await page.waitForSelector('#o[data-react-state="pending"]');
  await page.evaluate(() => document.getElementById('o').removeAttribute('data-react-island'));
  await page.waitForSelector('#in output[data-echo]');
  assert.deepEqual(errors, []);
});

test('data-react-ignore changes are followed', async () => {
  const { page, errors } = await open(
    '<section id="s" data-react-ignore><div id="x" data-react-island="Effect"><i>f</i></div></section>',
    { init: RECORD_EVENTS },
  );
  await tick(page);
  assert.equal(await page.getAttribute('#x', 'data-react-state'), null);
  await page.evaluate(() => document.getElementById('s').removeAttribute('data-react-ignore'));
  await page.waitForSelector('#x [data-effect]');
  await page.evaluate(() => document.getElementById('s').setAttribute('data-react-ignore', ''));
  await page.waitForFunction(() => window.__log.includes('unmount:x'));
  assert.equal(await page.innerHTML('#x'), '<i>f</i>');
  assert.deepEqual(errors, []);
});

test('a data-react-mount change while waiting starts again', async () => {
  const { page, errors } = await open('<div id="i" data-react-island="Echo" data-react-mount="idle">w</div>', {
    init: 'window.requestIdleCallback = function () { return 1; }; window.cancelIdleCallback = function () {};',
  });
  await tick(page);
  assert.equal(await page.getAttribute('#i', 'data-react-state'), 'waiting');
  await page.evaluate(() => document.getElementById('i').removeAttribute('data-react-mount'));
  await page.waitForSelector('#i output[data-echo]');
  assert.deepEqual(errors, []);
});

test('a new name and new props in one batch mount once with no update', async () => {
  const { page, errors } = await open('<main id="m"></main>', { init: RECORD_EVENTS });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'x';
    document.getElementById('m').append(d);
  });
  await tick(page);
  await page.evaluate(() => {
    const d = document.getElementById('x');
    d.setAttribute('data-react-island', 'Echo');
    d.setAttribute('data-react-props', '{"k":1}');
  });
  await page.waitForSelector('#x output:text("{\\"k\\":1}")');
  await tick(page);
  assert.deepEqual(await events(page), ['mount:Echo']);
  assert.deepEqual(errors, []);
});

test('a registration for React before 19 is refused', async () => {
  const { page, errors } = await open('', {
    files: {
      '/old.js':
        'window.autumnReact.push({ version: "18.3.1", createElement: function () {}, createRoot: function () {}, components: { Old: function () {} } });',
    },
    head: ['/react-islands.js', '/old.js', '/components.js'],
  });
  assert.equal(await page.evaluate(() => window.autumnReact.names().includes('Old')), false);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /React 19/);
});

// `<form name="addEventListener">` also breaks React itself, so the test
// uses only the names that the loader reads.
test('form names that clobber document do not stop the loader', async () => {
  const { page, errors } = await open(
    '<form name="documentElement"></form><form name="readyState"></form><form name="querySelector"></form>' +
      '<div id="x" data-react-island="Echo">x</div>',
  );
  await page.waitForSelector('#x output[data-echo]');
  assert.deepEqual(errors, []);
});

test('a form island with clobbering inputs still mounts and unmounts', async () => {
  const { page, errors } = await open(
    '<form id="f" data-react-island="Effect" data-react-props=\'{"tag":"form"}\'>' +
      '<input name="isConnected"><input name="childNodes"><input name="parentElement"><input name="nodeType"></form>',
    { init: RECORD_EVENTS },
  );
  await page.waitForSelector('#f [data-effect]');
  await page.evaluate(() => document.getElementById('f').remove());
  await page.waitForFunction(() => window.__log.includes('unmount:form'));
  assert.deepEqual(errors, []);
});

test('a sandboxed iframe named autumnReact does not stop the loader', async () => {
  const { page, errors } = await open(
    '<iframe name="autumnReact" sandbox></iframe><div id="x" data-react-island="Echo">x</div>',
  );
  await page.waitForSelector('#x output[data-echo]');
  assert.deepEqual(errors, []);
});

test('a __proto__ key in props is refused', async () => {
  const { page, errors } = await open(
    '<div id="x" data-react-island="Echo" data-react-props=\'{"__proto__":{"isAdmin":true}}\'>keep</div>',
  );
  await page.waitForSelector('#x[data-react-state="error"]');
  assert.equal(await page.textContent('#x'), 'keep');
  assert.equal(errors.length, 1, errors.join('\n'));
});
