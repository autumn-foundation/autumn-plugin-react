// The island bundle entry. It registers the demo components.
import { createElement, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { register } from './register.js';
import { Basket } from './Basket.jsx';
import { Broken } from './Broken.jsx';
import { Clock } from './Clock.jsx';
import { Counter } from './Counter.jsx';
import './islands.css';

// `flushSync`: the loader events fire after React commits.
// `version`: the loader refuses React before 19.
register({
  createElement,
  createRoot,
  flushSync,
  version,
  components: { Basket, Broken, Clock, Counter },
});
