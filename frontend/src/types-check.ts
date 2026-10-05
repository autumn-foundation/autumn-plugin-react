// Compile-time checks for autumn-react.d.ts. `npm run typecheck` runs tsc.
import { createElement, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { AutumnReactEntry, AutumnReactPropsDetail } from './autumn-react';

function Counter({ start }: { start: number }) {
  return createElement('output', null, start);
}

export const entry: AutumnReactEntry = {
  createElement,
  createRoot,
  flushSync,
  version,
  components: { Counter },
};

const single: AutumnReactPropsDetail = { props: { start: 1 } };
const list: AutumnReactPropsDetail = { value: [{ target: '#c', props: {} }, { props: {} }] };
export const details = [single, list];

document.addEventListener('autumn:react:mount', (event) => {
  const name: string = event.detail.name;
  return name;
});

const island = document.createElement('div');
island.addEventListener('autumn:react:error', (event) => event.detail.error);
island.dispatchEvent(new CustomEvent('autumn:react:props', { bubbles: true, detail: single }));
