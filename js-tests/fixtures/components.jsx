// Test components. The harness bundles this file with esbuild and real React.
import { createElement, useEffect, useId, useState, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { register } from '../../frontend/src/register.js';

window.__log = window.__log || [];

// Shows its props as JSON and its useId value.
function Echo(props) {
  const id = useId();
  return <output data-echo data-id={id}>{JSON.stringify(props)}</output>;
}

// Keeps state across props updates.
function Counter({ label = 'Count', start = 0 }) {
  const [n, setN] = useState(start);
  return (
    <button type="button" data-counter onClick={() => setN(n + 1)}>
      {label}: {n}
    </button>
  );
}

// Throws during render.
function Boom() {
  throw new Error('boom');
}

// Throws during render when `boom` is true.
function Fragile({ boom }) {
  if (boom) throw new Error('fragile');
  return <span data-fragile>ok</span>;
}

// Records mount and unmount in window.__log.
function Effect({ tag = 'x' }) {
  useEffect(() => {
    window.__log.push(`mount:${tag}`);
    return () => window.__log.push(`unmount:${tag}`);
  }, [tag]);
  return <span data-effect>{tag}</span>;
}

// Renders island markup inside its own root. The loader must skip it.
function Nest() {
  return (
    <div data-nest>
      <div data-react-island="Echo" data-react-props='{"inner":true}'>inner</div>
    </div>
  );
}

register({ createElement, createRoot, flushSync, version, components: { Echo, Counter, Boom, Effect, Fragile, Nest } });
