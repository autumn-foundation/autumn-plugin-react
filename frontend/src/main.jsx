// The island bundle entry. It registers the demo components.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { register } from './register.js';
import { Basket } from './Basket.jsx';
import { Broken } from './Broken.jsx';
import { Clock } from './Clock.jsx';
import { Counter } from './Counter.jsx';
import './islands.css';

register({ createElement, createRoot, components: { Basket, Broken, Clock, Counter } });
