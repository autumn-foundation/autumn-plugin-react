// autumn-plugin-react: the island loader.
//
// Mounts React components into `[data-react-island]` elements. The app
// bundle registers its components on `window.autumnReact`:
//
//   autumnReact.push({ createElement, createRoot, components: { Counter } })
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
  const existing = win.autumnReact;
  // A second copy of the loader does nothing.
  if (existing && existing.loader === true) return;
  // An element with id="autumnReact" can clobber the global. Use only a
  // real queue.
  const queued = Array.isArray(existing) ? existing : [];

  // Prototype methods: an island or `document` cannot clobber them.
  const E = Element.prototype;
  const getAttr = (el, name) => E.getAttribute.call(el, name);
  const setAttr = (el, name, value) => E.setAttribute.call(el, name, value);
  const closest = (el, selector) => E.closest.call(el, selector);
  const findAll = (root, selector) =>
    root === document
      ? Document.prototype.querySelectorAll.call(root, selector)
      : E.querySelectorAll.call(root, selector);
  const matches = (el, selector) => E.matches.call(el, selector);

  /** name -> { component, createElement, createRoot } */
  const registry = new Map();
  /** element -> record */
  const records = new WeakMap();
  /** Records with a root, a pending trigger, or a pending name. */
  const live = new Set();
  let rootCount = 0;

  function emit(record, type, error) {
    const target = record.el.isConnected ? record.el : document;
    const detail = { name: record.name, element: record.el };
    if (error !== undefined) detail.error = error;
    target.dispatchEvent(new CustomEvent('autumn:react:' + type, { bubbles: true, detail }));
  }

  function setState(record, state) {
    record.state = state;
    setAttr(record.el, STATE, state);
  }

  // Returns the props object. Throws when the JSON is bad or not an object.
  function readProps(el) {
    const text = getAttr(el, PROPS);
    if (text === null || text === '') return {};
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(PROPS + ' must be a JSON object');
    }
    return value;
  }

  function fail(record, message, error) {
    console.error(PREFIX + 'island "' + record.name + '" ' + message, error);
    setState(record, 'error');
    emit(record, 'error', error);
  }

  // Moves the fallback nodes out of the island, into the record.
  function takeFallback(record) {
    record.fallback = Array.from(record.el.childNodes);
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

  // React 19 calls this when a render error is not caught by an error
  // boundary. React removes the tree. Put the fallback back.
  function crashed(record, root, error) {
    if (record.root !== root) return;
    queueMicrotask(() => {
      if (record.root !== root) return;
      unmountRoot(record);
      restoreFallback(record);
      fail(record, 'crashed during render:', error);
    });
  }

  function mount(record, entry) {
    let props;
    try {
      props = readProps(record.el);
    } catch (error) {
      fail(record, 'has bad props:', error);
      return;
    }
    takeFallback(record);
    rootCount += 1;
    try {
      const root = entry.createRoot(record.el, {
        identifierPrefix: 'autumn-react-' + rootCount + '-',
        onUncaughtError: (error) => crashed(record, root, error),
      });
      record.root = root;
      root.render(entry.createElement(entry.component, props));
    } catch (error) {
      unmountRoot(record);
      restoreFallback(record);
      fail(record, 'did not mount:', error);
      return;
    }
    record.entry = entry;
    setState(record, 'mounted');
    emit(record, 'mount');
  }

  // Renders a mounted island again with new props. React keeps the state.
  function update(record) {
    let props;
    try {
      props = readProps(record.el);
    } catch (error) {
      fail(record, 'has bad props:', error);
      return;
    }
    record.root.render(record.entry.createElement(record.entry.component, props));
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
    const parent = el.parentElement;
    return parent !== null && closest(parent, ISLAND_SELECTOR) !== null;
  }

  function consider(el) {
    if (records.has(el) || skipped(el)) return;
    const record = { el, name: getAttr(el, ISLAND), state: null, root: null, cancel: null, fallback: null, entry: null };
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

  // Stops all work for a record. `restore` puts the fallback back.
  function teardown(record, restore) {
    if (record.cancel) record.cancel();
    record.cancel = null;
    const hadRoot = unmountRoot(record);
    if (restore) restoreFallback(record);
    records.delete(record.el);
    live.delete(record);
    if (hadRoot) emit(record, 'unmount');
  }

  function scan(root) {
    if (root.nodeType !== 1 && root !== document) return;
    if (root !== document && matches(root, ISLAND_SELECTOR)) consider(root);
    for (const el of findAll(root, ISLAND_SELECTOR)) consider(el);
  }

  // A mutation inside an island belongs to React (or to the fallback).
  function insideIsland(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el !== null && closest(el, ISLAND_SELECTOR) !== null;
  }

  function attributeChanged(el, attribute) {
    const record = records.get(el);
    if (!record) {
      if (getAttr(el, ISLAND) !== null) consider(el);
      return;
    }
    if (attribute === PROPS && record.root) {
      update(record);
    } else if (attribute === ISLAND || (attribute === PROPS && record.state === 'error')) {
      // A new component, or a new chance after an error: start again.
      teardown(record, true);
      if (getAttr(el, ISLAND) !== null) consider(el);
    }
  }

  function observe(mutations) {
    // Unmount removed islands first. A moved island is connected again by
    // now, so it keeps its root.
    if (mutations.some((m) => m.removedNodes.length > 0 && !insideIsland(m.target))) {
      for (const record of Array.from(live)) {
        if (!record.el.isConnected) teardown(record, false);
      }
    }
    for (const m of mutations) {
      if (m.type === 'attributes') {
        attributeChanged(m.target, m.attributeName);
      } else if (!insideIsland(m.target)) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) scan(node);
        }
      }
    }
  }

  function register(entry) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.createRoot !== 'function' ||
      typeof entry.createElement !== 'function' ||
      entry.components === null ||
      typeof entry.components !== 'object'
    ) {
      console.error(PREFIX + 'a registration needs createElement, createRoot and components', entry);
      return;
    }
    const added = new Set();
    const components = entry.components;
    for (const name in components) {
      if (!Object.prototype.hasOwnProperty.call(components, name)) continue;
      if (registry.has(name)) {
        console.error(PREFIX + 'component "' + name + '" is already registered; the first one stays');
        continue;
      }
      registry.set(name, {
        component: components[name],
        createElement: entry.createElement,
        createRoot: entry.createRoot,
      });
      added.add(name);
    }
    for (const record of Array.from(live)) {
      if (record.state === 'pending' && added.has(record.name)) activate(record);
    }
  }

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
  new MutationObserver(observe).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ISLAND, PROPS, MOUNT],
  });
  scan(document);
})();
