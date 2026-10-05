// The loader: mount, props, registry, errors and safety rules.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_EVENTS, addScript, close, launch, open } from './harness.mjs';

before(launch);
after(close);

const echo = (props, fallback = 'fallback', extra = '') =>
  `<div ${extra} data-react-island="Echo" data-react-props='${JSON.stringify(props)}'>${fallback}</div>`;

async function echoed(page, selector = '[data-react-island="Echo"]') {
  await page.waitForSelector(`${selector} output[data-echo]`);
  return JSON.parse(await page.textContent(`${selector} output[data-echo]`));
}

test('mounts a React component with its props under a strict CSP', async () => {
  const { page, errors, violations } = await open(echo({ a: 1, s: '<b>"x"</b>' }), { init: RECORD_EVENTS });
  assert.deepEqual(await echoed(page), { a: 1, s: '<b>"x"</b>' });
  const island = page.locator('[data-react-island]');
  assert.equal(await island.getAttribute('data-react-state'), 'mounted');
  assert.equal(await island.textContent(), '{"a":1,"s":"<b>\\"x\\"</b>"}', 'the fallback is gone');
  assert.deepEqual(await page.evaluate(() => window.__events), ['mount:Echo']);
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
});

test('an island without props gets empty props', async () => {
  const { page, errors } = await open('<div data-react-island="Echo">x</div>');
  assert.deepEqual(await echoed(page), {});
  assert.deepEqual(errors, []);
});

test('the app bundle can run before the loader', async () => {
  const { page, errors } = await open(echo({ order: 'bundle-first' }), {
    head: ['/components.js', '/react-islands.js'],
  });
  assert.deepEqual(await echoed(page), { order: 'bundle-first' });
  assert.deepEqual(errors, []);
});

test('the loader exposes the registered names and a loader flag', async () => {
  const { page } = await open('');
  const state = await page.evaluate(() => ({
    loader: window.autumnReact.loader,
    names: window.autumnReact.names(),
  }));
  assert.equal(state.loader, true);
  assert.deepEqual(state.names, ['Boom', 'Counter', 'Echo', 'Effect', 'Nest']);
});

test('an unknown component waits with its fallback, then a late bundle mounts it', async () => {
  const { page, errors } = await open(
    `<div id="late" data-react-island="Late" data-react-props='{"text":"hi"}'>wait</div>${echo({ k: 1 })}`,
  );
  await echoed(page);
  const late = page.locator('#late');
  assert.equal(await late.getAttribute('data-react-state'), 'pending');
  assert.equal(await late.textContent(), 'wait');
  await addScript(page, '/late.js');
  await page.waitForSelector('#late em[data-late]');
  assert.equal(await late.textContent(), 'hi');
  assert.equal(await late.getAttribute('data-react-state'), 'mounted');
  // The first `Echo` stays. The duplicate gives one console error.
  assert.deepEqual(await echoed(page), { k: 1 });
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /Echo/);
});

test('bad props JSON affects that island only', async () => {
  const { page, errors } = await open(
    `<div id="bad" data-react-island="Echo" data-react-props='{nope'>keep</div>${echo({ ok: true }, 'f', 'id="good"')}`,
    { init: RECORD_EVENTS },
  );
  assert.deepEqual(await echoed(page, '#good'), { ok: true });
  const bad = page.locator('#bad');
  assert.equal(await bad.getAttribute('data-react-state'), 'error');
  assert.equal(await bad.textContent(), 'keep');
  assert.ok((await page.evaluate(() => window.__events)).includes('error:Echo'));
  assert.equal(errors.length, 1, errors.join('\n'));
});

test('props that are not a JSON object are an error', async () => {
  for (const props of ['[1]', '5', 'null', '"s"']) {
    const { page, errors } = await open(`<div id="x" data-react-island="Echo" data-react-props='${props}'>keep</div>`);
    await page.waitForSelector('#x[data-react-state="error"]');
    assert.equal(await page.textContent('#x'), 'keep', props);
    assert.equal(errors.length, 1, `${props}: ${errors.join('\n')}`);
  }
});

test('a render error puts the fallback back and affects that island only', async () => {
  const { page, errors } = await open(
    `<div id="boom" data-react-island="Boom"><p>server <b>copy</b></p></div>${echo({ ok: 1 }, 'f', 'id="good"')}`,
    { init: RECORD_EVENTS },
  );
  await page.waitForSelector('#boom[data-react-state="error"]');
  assert.equal(await page.innerHTML('#boom'), '<p>server <b>copy</b></p>');
  assert.deepEqual(await echoed(page, '#good'), { ok: 1 });
  assert.ok((await page.evaluate(() => window.__events)).includes('error:Boom'));
  assert.ok(errors.length >= 1 && errors.every((e) => /boom/.test(e)), errors.join('\n'));
});

test('each root gets a unique identifierPrefix for useId', async () => {
  const { page, errors } = await open(`${echo({ n: 1 }, 'a', 'id="a"')}${echo({ n: 2 }, 'b', 'id="b"')}`);
  await echoed(page, '#a');
  await echoed(page, '#b');
  const ids = await page.$$eval('output[data-echo]', (os) => os.map((o) => o.dataset.id));
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.match(id, /autumn-react-\d+-/);
  assert.deepEqual(errors, []);
});

test('islands inside data-react-ignore do not mount', async () => {
  const { page, errors } = await open(
    `<section data-react-ignore>${echo({ x: 1 }, 'user html', 'id="ignored"')}</section>${echo({ y: 2 }, 'f', 'id="good"')}`,
  );
  await echoed(page, '#good');
  assert.equal(await page.textContent('#ignored'), 'user html');
  assert.equal(await page.getAttribute('#ignored', 'data-react-state'), null);
  assert.deepEqual(errors, []);
});

test('an island inside another island does not mount', async () => {
  const { page, errors } = await open(
    `<div id="outer" data-react-island="Missing">${echo({ inner: 1 }, 'inner', 'id="inner"')}</div>${echo({ y: 2 }, 'f', 'id="good"')}`,
  );
  await echoed(page, '#good');
  assert.equal(await page.getAttribute('#outer', 'data-react-state'), 'pending');
  assert.equal(await page.getAttribute('#inner', 'data-react-state'), null);
  assert.equal(await page.textContent('#inner'), 'inner');
  assert.deepEqual(errors, []);
});

test('island markup that React renders does not mount', async () => {
  const { page, errors } = await open('<div id="nest" data-react-island="Nest">x</div>');
  await page.waitForSelector('#nest [data-nest]');
  // Give the observer a chance to act.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  assert.equal(await page.textContent('#nest [data-nest]'), 'inner');
  assert.equal(await page.locator('#nest [data-nest] [data-react-state]').count(), 0);
  assert.deepEqual(errors, []);
});

test('a second loader copy does nothing', async () => {
  const { page, errors } = await open(echo({ once: true }), {
    init: RECORD_EVENTS,
    head: ['/react-islands.js', '/react-islands.js', '/components.js'],
  });
  assert.deepEqual(await echoed(page), { once: true });
  assert.deepEqual(await page.evaluate(() => window.__events), ['mount:Echo']);
  assert.deepEqual(errors, []);
});

test('an element with id="autumnReact" does not break the loader', async () => {
  const { page, errors } = await open(`<div id="autumnReact"></div>${echo({ c: 1 })}`, {
    head: ['/react-islands.js', '/components.js'],
  });
  assert.deepEqual(await echoed(page), { c: 1 });
  assert.equal(await page.evaluate(() => window.autumnReact.loader), true);
  assert.deepEqual(errors, []);
});

test('Object.prototype names do not resolve to a component', async () => {
  const { page, errors } = await open(
    `<div id="p" data-react-island="__proto__">a</div><div id="c" data-react-island="constructor">b</div>${echo({ ok: 1 })}`,
  );
  await echoed(page);
  assert.equal(await page.getAttribute('#p', 'data-react-state'), 'pending');
  assert.equal(await page.getAttribute('#c', 'data-react-state'), 'pending');
  assert.deepEqual(errors, []);
});

test('a registration without createRoot is refused with a console error', async () => {
  const { page, errors } = await open(echo({ ok: 1 }), {
    files: { '/broken.js': 'window.autumnReact.push({ components: { Broken: function () {} } });' },
    head: ['/react-islands.js', '/broken.js', '/components.js'],
  });
  await echoed(page);
  assert.deepEqual(await page.evaluate(() => window.autumnReact.names().includes('Broken')), false);
  assert.equal(errors.length, 1, errors.join('\n'));
});
