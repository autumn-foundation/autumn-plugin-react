// The `autumn:react:props` event: new props from the server or app code.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { close, launch, open } from './harness.mjs';

before(launch);
after(close);

const COUNTER = '<div id="c" data-react-island="Counter" data-react-props=\'{"label":"Hits"}\'>f</div>';

// Same shape as htmx gives for `HX-Trigger: {"autumn:react:props":[...]}`.
function trigger(page, from, list) {
  return page.evaluate(
    ([sel, value]) =>
      document.querySelector(sel).dispatchEvent(
        new CustomEvent('autumn:react:props', { bubbles: true, detail: { value } }),
      ),
    [from, list],
  );
}

test('a list of updates sets new props and React keeps the state', async () => {
  const { page, errors } = await open(`<button id="b">go</button>${COUNTER}`);
  await page.click('#c button');
  await page.waitForSelector('#c button:text("Hits: 1")');
  await trigger(page, '#b', [{ target: '#c', props: { label: 'Clicks' } }]);
  await page.waitForSelector('#c button:text("Clicks: 1")');
  assert.equal(await page.getAttribute('#c', 'data-react-props'), '{"label":"Clicks"}');
  assert.deepEqual(errors, []);
});

test('app code can send props to an island without a target', async () => {
  const { page, errors } = await open(COUNTER);
  await page.waitForSelector('#c button');
  await page.evaluate(() =>
    document.getElementById('c').dispatchEvent(
      new CustomEvent('autumn:react:props', { bubbles: true, detail: { props: { label: 'Own' } } }),
    ),
  );
  await page.waitForSelector('#c button:text("Own: 0")');
  assert.deepEqual(errors, []);
});

test('a bad update gives a console error and changes nothing else', async () => {
  const { page, errors } = await open(`<button id="b">go</button><p id="not">x</p>${COUNTER}`);
  await page.waitForSelector('#c button');
  await trigger(page, '#b', [
    { target: '#missing', props: {} },
    { target: '[bad', props: {} },
    { target: '#not', props: {} },
    { target: '#c', props: [1] },
    { target: '#c' },
    null,
    { target: '#c', props: { label: 'Good' } },
  ]);
  await page.waitForSelector('#c button:text("Good: 0")');
  assert.equal(errors.length, 6, errors.join('\n'));
  assert.equal(await page.getAttribute('#not', 'data-react-props'), null);
});
