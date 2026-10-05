// autumn-plugin-react: the island loader. Needs React 19 or later.
//
// Mounts React components into `[data-react-island]` elements. The app
// bundle registers its components on `window.autumnReact`:
//
//   autumnReact.push({ createElement, createRoot, flushSync, version,
//                      components: { Counter } })
//
// One MutationObserver mounts added islands, unmounts removed islands and
// renders again when `data-react-props` changes. No eval, no HTML strings,
// no inline script: the file works under `script-src 'self'`.
(function () {
  'use strict';

  const ISLAND = 'data-react-island';
  const PROPS = 'data-react-props';
  const MOUNT = 'data-react-mount';
  const STATE = 'data-react-state';
  const IGNORE = 'data-react-ignore';
  const ISLAND_SELECTOR = '[' + ISLAND + ']';
  const IGNORE_SELECTOR = '[' + IGNORE + ']';
  const PREFIX = 'autumn-react: ';

  const win = window;
  let existing;
  try {
    existing = win.autumnReact;
    // A second copy of the loader does nothing.
    if (existing && existing.loader === true) return;
  } catch (error) {
    // A cross-origin frame named "autumnReact" throws on access.
    existing = undefined;
  }
  // An element or a frame can clobber the global. Use only a real queue.
  const queued = Array.isArray(existing) ? existing : [];

  // Prototype methods and getters: an element named like a DOM property
  // (`<form name="documentElement">`, `<input name="nodeType">`) cannot
  // clobber them.
  const N = Node.prototype;
  const E = Element.prototype;
  const D = Document.prototype;
  const T = EventTarget.prototype;
  const getter = (proto, name) => Object.getOwnPropertyDescriptor(proto, name).get;
  const isConnected = getter(N, 'isConnected');
  const childNodes = getter(N, 'childNodes');
  const parentElement = getter(N, 'parentElement');
  const nodeType = getter(N, 'nodeType');
  const documentElement = getter(D, 'documentElement');
  const readyState = getter(D, 'readyState');
  const connected = (node) => isConnected.call(node);
  const isElement = (node) => nodeType.call(node) === 1;
  const contains = (outer, inner) => N.contains.call(outer, inner);
  const getAttr = (el, name) => E.getAttribute.call(el, name);
  const setAttr = (el, name, value) => E.setAttribute.call(el, name, value);
  const closest = (el, selector) => E.closest.call(el, selector);
  const findAll = (el, selector) => E.querySelectorAll.call(el, selector);
  const matches = (el, selector) => E.matches.call(el, selector);
  const on = (target, type, listener) => T.addEventListener.call(target, type, listener);
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

  /** name -> { component, createElement, createRoot, flushSync } */
  const registry = new Map();
  /** element -> record */
  const records = new WeakMap();
  /** Records with a root, a pending trigger, or a pending name. */
  const live = new Set();
  let rootCount = 0;

  function emit(record, type, error) {
    const target = connected(record.el) ? record.el : document;
    const detail = { name: record.name, element: record.el };
    if (error !== undefined) detail.error = error;
    T.dispatchEvent.call(target, new CustomEvent('autumn:react:' + type, { bubbles: true, detail }));
  }

  function setState(record, state) {
    record.state = state;
    setAttr(record.el, STATE, state);
  }

  function fail(record, message, error) {
    console.error(PREFIX + 'island "' + record.name + '" ' + message, error);
    setState(record, 'error');
    emit(record, 'error', error);
  }

  // Throws when `value` is not a props object.
  function checkProps(value) {
    if (!isPlainObject(value)) throw new TypeError('props must be a JSON object');
    // React copies props with `props[key] = value`. A `__proto__` key
    // would set the prototype of the props object.
    if (hasOwn(value, '__proto__')) throw new TypeError('props must not have a __proto__ key');
    return value;
  }

  // Returns the props object, or `null` after `fail` for bad props.
  function readProps(record) {
    const text = getAttr(record.el, PROPS);
    if (text === null || text === '') return {};
    try {
      return checkProps(JSON.parse(text));
    } catch (error) {
      fail(record, 'has bad props:', error);
      return null;
    }
  }

  // Moves the fallback nodes out of the island, into the record.
  function takeFallback(record) {
    record.fallback = Array.from(childNodes.call(record.el));
    E.replaceChildren.call(record.el);
  }

  function restoreFallback(record) {
    if (record.fallback) E.replaceChildren.apply(record.el, record.fallback);
    record.fallback = null;
  }

  function unmountRoot(record) {
    const root = record.root;
    if (!root) return false;
    record.root = null;
    try {
      root.unmount();
    } catch (error) {
      console.error(PREFIX + 'island "' + record.name + '" did not unmount', error);
    }
    return true;
  }

  // React calls this when a render error is not caught by an error
  // boundary. React removes the tree. Put the fallback back after React
  // is done, in a microtask.
  function crashed(record, root, error) {
    if (record.root !== root) return;
    record.crashed = true;
    queueMicrotask(() => {
      if (record.root !== root) return;
      unmountRoot(record);
      restoreFallback(record);
      fail(record, 'crashed during render:', error);
    });
  }

  // With `flushSync`, React commits before this returns.
  function render(record, props) {
    const entry = record.entry;
    const element = entry.createElement(entry.component, props);
    if (entry.flushSync) entry.flushSync(() => record.root.render(element));
    else record.root.render(element);
  }

  function mount(record, entry) {
    const props = readProps(record);
    if (props === null) return;
    takeFallback(record);
    rootCount += 1;
    record.entry = entry;
    record.crashed = false;
    try {
      const root = entry.createRoot(record.el, {
        identifierPrefix: 'autumn-react-' + rootCount + '-',
        onUncaughtError: (error) => crashed(record, root, error),
      });
      record.root = root;
      render(record, props);
    } catch (error) {
      unmountRoot(record);
      restoreFallback(record);
      fail(record, 'did not mount:', error);
      return;
    }
    if (record.crashed) return;
    setState(record, 'mounted');
    emit(record, 'mount');
  }

  // Renders a mounted island again with new props. React keeps the state.
  function update(record) {
    const props = readProps(record);
    if (props === null) return;
    render(record, props);
    if (record.crashed) return;
    setState(record, 'mounted');
    emit(record, 'update');
  }

  function activate(record) {
    record.cancel = null;
    const entry = registry.get(record.name);
    if (entry) mount(record, entry);
    else setState(record, 'pending');
  }

  let visibility = null;
  function observeVisible(record) {
    if (typeof IntersectionObserver !== 'function') {
      activate(record);
      return;
    }
    if (!visibility) {
      visibility = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          visibility.unobserve(entry.target);
          const record = records.get(entry.target);
          if (record && record.state === 'waiting') activate(record);
        }
      });
    }
    visibility.observe(record.el);
    record.cancel = () => visibility.unobserve(record.el);
  }

  function waitForIdle(record) {
    const run = () => activate(record);
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(run, { timeout: 2000 });
      record.cancel = () => win.cancelIdleCallback(id);
    } else {
      const id = setTimeout(run, 200);
      record.cancel = () => clearTimeout(id);
    }
  }

  // Islands in `[data-react-ignore]` or in another island never mount.
  function skipped(el) {
    if (closest(el, IGNORE_SELECTOR)) return true;
    const parent = parentElement.call(el);
    return parent !== null && closest(parent, ISLAND_SELECTOR) !== null;
  }

  // Stops all work for a record and puts the fallback back.
  function teardown(record) {
    if (record.cancel) record.cancel();
    record.cancel = null;
    const hadRoot = unmountRoot(record);
    restoreFallback(record);
    E.removeAttribute.call(record.el, STATE);
    records.delete(record.el);
    live.delete(record);
    if (hadRoot) emit(record, 'unmount');
  }

  // Tears down each live record at or inside `el`.
  function teardownWithin(el) {
    for (const record of Array.from(live)) {
      if (contains(el, record.el)) teardown(record);
    }
  }

  function consider(el) {
    // Before DOMContentLoaded the island can be half parsed.
    if (readyState.call(document) === 'loading') return;
    if (!connected(el) || records.has(el) || skipped(el)) return;
    // htmx history restore brings back old React output, not a fallback.
    if (getAttr(el, STATE) === 'mounted') E.replaceChildren.call(el);
    // A live island inside a new island belongs to the new island now.
    for (const record of Array.from(live)) {
      if (record.el !== el && contains(el, record.el)) teardown(record);
    }
    const record = {
      el,
      name: getAttr(el, ISLAND),
      state: null,
      root: null,
      entry: null,
      crashed: false,
      cancel: null,
      fallback: null,
    };
    records.set(el, record);
    live.add(record);
    const when = getAttr(el, MOUNT);
    if (when === 'idle' || when === 'visible') {
      setState(record, 'waiting');
      if (when === 'idle') waitForIdle(record);
      else observeVisible(record);
    } else {
      activate(record);
    }
  }

  // Checks `el` and each island in it. A live island that moved into an
  // ignored region or into another island is torn down.
  function scan(el) {
    const islands = Array.from(findAll(el, ISLAND_SELECTOR));
    if (matches(el, ISLAND_SELECTOR)) islands.unshift(el);
    for (const island of islands) {
      const record = records.get(island);
      if (!record) consider(island);
      else if (skipped(island)) teardown(record);
    }
  }

  // A mutation inside an island belongs to React (or to the fallback).
  function insideIsland(node) {
    const el = isElement(node) ? node : parentElement.call(node);
    return el !== null && closest(el, ISLAND_SELECTOR) !== null;
  }

  // `fresh` holds elements that got a record in this batch. They already
  // use their current attributes.
  function attributeChanged(el, attribute, fresh) {
    if (!connected(el) || fresh.has(el)) return;
    if (attribute === IGNORE) {
      if (getAttr(el, IGNORE) !== null) teardownWithin(el);
      else scan(el);
      return;
    }
    const record = records.get(el);
    if (!record) {
      if (getAttr(el, ISLAND) !== null) {
        consider(el);
        fresh.add(el);
      }
      return;
    }
    if (attribute === PROPS && record.root) {
      update(record);
      return;
    }
    const restart =
      attribute === ISLAND ||
      (attribute === PROPS && record.state === 'error') ||
      (attribute === MOUNT && record.state === 'waiting');
    if (!restart) return;
    teardown(record);
    fresh.add(el);
    // Not an island now: the islands in it can mount.
    scan(el);
  }

  function observe(mutations) {
    // Unmount removed islands first. A moved island is connected again by
    // now, so it keeps its root.
    if (mutations.some((m) => m.removedNodes.length > 0 && !insideIsland(m.target))) {
      for (const record of Array.from(live)) {
        if (!connected(record.el)) teardown(record);
      }
    }
    const fresh = new Set();
    for (const m of mutations) {
      if (m.type === 'attributes') {
        attributeChanged(m.target, m.attributeName, fresh);
      } else if (!insideIsland(m.target)) {
        for (const node of m.addedNodes) {
          if (isElement(node)) scan(node);
        }
      }
    }
  }

  // Returns the React major version, or `null` when the entry has none.
  function majorVersion(entry) {
    if (typeof entry.version !== 'string') return null;
    const major = parseInt(entry.version, 10);
    return Number.isNaN(major) ? null : major;
  }

  function register(entry) {
    if (
      !isPlainObject(entry) ||
      typeof entry.createRoot !== 'function' ||
      typeof entry.createElement !== 'function' ||
      !isPlainObject(entry.components)
    ) {
      console.error(PREFIX + 'a registration needs createElement, createRoot and components', entry);
      return;
    }
    const major = majorVersion(entry);
    if (major !== null && major < 19) {
      console.error(PREFIX + 'the loader needs React 19 or later, not ' + entry.version);
      return;
    }
    const flushSync = typeof entry.flushSync === 'function' ? entry.flushSync : null;
    const added = new Set();
    const components = entry.components;
    for (const name in components) {
      if (!hasOwn(components, name)) continue;
      if (registry.has(name)) {
        console.error(PREFIX + 'component "' + name + '" is already registered; the first one stays');
        continue;
      }
      registry.set(name, {
        component: components[name],
        createElement: entry.createElement,
        createRoot: entry.createRoot,
        flushSync,
      });
      added.add(name);
    }
    for (const record of Array.from(live)) {
      if (record.state === 'pending' && added.has(record.name)) activate(record);
    }
  }

  // Sets new props from one `{ target, props }` update. `origin` is the
  // event target. It is the island when the update has no `target`.
  function applyProps(update, origin) {
    if (!isPlainObject(update)) {
      console.error(PREFIX + 'a props update must be an object', update);
      return;
    }
    let el = origin;
    if (typeof update.target === 'string') {
      try {
        el = D.querySelector.call(document, update.target);
      } catch (error) {
        el = null;
      }
    }
    if (!el || !isElement(el) || getAttr(el, ISLAND) === null) {
      console.error(PREFIX + 'no island for the props update', update.target);
      return;
    }
    try {
      checkProps(update.props);
    } catch (error) {
      console.error(PREFIX + 'props update for "' + getAttr(el, ISLAND) + '" is bad:', error);
      return;
    }
    // The observer sees the attribute change and renders again.
    setAttr(el, PROPS, JSON.stringify(update.props));
  }

  // htmx sends `HX-Trigger: {"autumn:react:props": [...]}` as
  // `detail.value`. App code can send `detail: { target?, props }`.
  on(document, 'autumn:react:props', (event) => {
    const detail = event.detail;
    const updates = detail && Array.isArray(detail.value) ? detail.value : [detail];
    for (const update of updates) applyProps(update, event.target);
  });

  win.autumnReact = {
    loader: true,
    /** Registers `{ createElement, createRoot, components }` entries. */
    push(...entries) {
      for (const entry of entries) register(entry);
      return registry.size;
    },
    /** The registered component names, sorted. */
    names() {
      return Array.from(registry.keys()).sort();
    },
  };

  for (const entry of queued) register(entry);
  const root = documentElement.call(document);
  new MutationObserver(observe).observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ISLAND, PROPS, MOUNT, IGNORE],
  });
  if (readyState.call(document) === 'loading') {
    on(document, 'DOMContentLoaded', () => scan(documentElement.call(document)));
  } else {
    scan(root);
  }
})();
