// A second bundle that registers later. It also tries to take `Echo`.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { register } from '../../frontend/src/register.js';

function Late({ text = 'late' }) {
  return <em data-late>{text}</em>;
}

function NotEcho() {
  return <b data-not-echo>wrong</b>;
}

register({ createElement, createRoot, components: { Late, Echo: NotEcho } });
