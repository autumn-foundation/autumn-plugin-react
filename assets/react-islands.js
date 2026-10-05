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
  const findAll = (el, selector) => E.querySelectorAll.call(el, selector);
  const matches = (el, selector) => E.matches.call(el, selector);
  const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

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

  function fail(record, message, error) {
    console.error(PREFIX + 'island "' + record.name + '" ' + message, error);
    setState(record, 'error');
    emit(record, 'error', error);
  }

  // Returns the props object, or `null` after `fail` for bad props.
  function readProps(record) {
    const text = getAttr(record.el, PROPS);
    if (text === null || text === '') return {};
    try {
      const value = JSON.parse(text);
      if (isPlainObject(value)) return value;
      throw new TypeError(PROPS + ' must be a JSON object');
    } catch (error) {
      fail(record, 'has bad props:', error);
      return null;
    }
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
    const props = readProps(record);
    if (props === null) return;
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
    const props = readProps(record);
    if (props === null) return;
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
    const record = {
      el,
      name: getAttr(el, ISLAND),
      state: null,
      root: null,
      entry: null,
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

  // Considers `el` and each island in it.
  function scan(el) {
    if (matches(el, ISLAND_SELECTOR)) consider(el);
    for (const island of findAll(el, ISLAND_SELECTOR)) consider(island);
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
      !isPlainObject(entry) ||
      typeof entry.createRoot !== 'function' ||
      typeof entry.createElement !== 'function' ||
      !isPlainObject(entry.components)
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
        el = Document.prototype.querySelector.call(document, update.target);
      } catch (error) {
        el = null;
      }
    }
    if (!el || el.nodeType !== 1 || getAttr(el, ISLAND) === null) {
      console.error(PREFIX + 'no island for the props update', update.target);
      return;
    }
    const props = update.props;
    if (!isPlainObject(props)) {
      console.error(PREFIX + 'props update for "' + getAttr(el, ISLAND) + '" needs a props object');
      return;
    }
    // The observer sees the attribute change and renders again.
    setAttr(el, PROPS, JSON.stringify(props));
  }

  // htmx sends `HX-Trigger: {"autumn:react:props": [...]}` as
  // `detail.value`. App code can send `detail: { target?, props }`.
  document.addEventListener('autumn:react:props', (event) => {
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
  new MutationObserver(observe).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ISLAND, PROPS, MOUNT],
  });
  scan(document.documentElement);
})();
