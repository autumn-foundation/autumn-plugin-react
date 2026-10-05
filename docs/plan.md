# Plan: autumn-plugin-react 0.1.0

Target: `autumn-web` 0.8.0. Writing rule: ASD-STE100. Short sentences.
Active voice. One topic in each sentence.

## 1. Problem

Autumn renders HTML on the server with Maud and htmx. Some parts of a page
need rich client state: an editor, a chart, a date picker. React is a common
tool for these parts. Autumn has no standard way to put a React component
into a Maud page. Each app must write its own loader, script tags and
cleanup code. The `examples/react-graphql` app in the Autumn repo shows the
other choice: one React app that owns the full page. That choice loses
server rendering, htmx and the Maud layout.

## 2. Goal

Let an app put React components ("islands") into Maud pages:

- Serve a small island loader through the Autumn 0.8 `plugin_assets` seam.
- Serve the app's compiled components through the same seam.
- Give a typed Rust `Island` builder that renders the mount element.
- Mount and unmount islands when htmx changes the page.
- Work under the default CSP (`script-src 'self'`). Use no inline script.

## 3. Brainstorming

Ideas, not filtered:

1. A loader file (`react-islands.js`) as a `PluginAssets` bundle. It gets a
   hashed URL, `immutable` cache and SRI.
2. A Rust `Island` builder: component name, JSON props, fallback, `id`,
   `class`, mount strategy.
3. The app bundle registers components on a queue:
   `window.autumnReact.push({ createElement, createRoot, components })`.
   Script order does not matter.
4. The app brings its own `react` and `react-dom`. The plugin does not
   vendor React. The app selects the version (18 or 19).
5. One `MutationObserver` mounts added islands and unmounts removed islands.
   It covers htmx swaps, history restore and manual DOM edits.
6. A change to `data-react-props` renders the same root again. React keeps
   the component state. The server can push new props with an htmx swap.
7. Give each root its own `identifierPrefix`. Then `useId` values do not
   collide between islands.
8. Use the React 19 root option `onUncaughtError`. On a crash, put the
   fallback back and send `autumn:react:error`.
9. Mount strategies: `load`, `idle`, `visible`.
10. DOM events (`autumn:react:mount`, `:update`, `:unmount`, `:error`) for
    htmx `hx-trigger` and for app code.
10a. A server handler sends new props in an `HX-Trigger` header
    (`PropsUpdate`). The loader applies them to the island. Found during
    GREEN: `HxResponseExt::hx_trigger` drops a value that is not visible
    ASCII, so the helper escapes all other characters.
11. `ReactPlugin::bundle(&BUNDLE)` installs the app bundle. `react_bundle`
    renders its `<link>` and `<script>` tags.
12. A reference frontend (esbuild + React 19 + JSX). Commit its output, so
    the example runs with no Node.
13. Hydrate server HTML with `hydrateRoot`. **Rejected**: Rust cannot
    render React. A Node process at run time stops the deploy of one binary.
14. Vendor React and use an import map. **Rejected**: an import map is an
    inline script. CSP `script-src 'self'` blocks it. It also pins the React
    version to the plugin.
15. Read the Vite `manifest.json` at run time. **Rejected**: `PluginAssets`
    already gives hashed URLs and SRI with no manifest.
16. Wrap each island in `StrictMode`. **Deferred**: the app can wrap its own
    components.

## 4. Reverse brainstorming

Question: "How can this plugin fail its users?" Each answer gives a control.

| How to fail | Control |
| --- | --- |
| htmx removes an island and the React root leaks. | The observer unmounts each island that is not connected after a microtask. |
| A morph moves an island (remove, then add). The state is lost. | The loader unmounts only when the element is not connected. |
| A re-scan mounts one island two times. | One record for each element (`WeakMap`). |
| Props inject HTML or script. | Props go only in an attribute. Maud escapes it. The loader uses `JSON.parse`. It uses no `innerHTML` and no `eval`. |
| The name `__proto__` or `constructor` reads `Object.prototype`. | The registry is a `Map`. It copies only own properties. |
| The plugin breaks the default CSP. | No inline script, no `eval`, no import map. A test scans the loader. A browser test runs under a strict CSP. |
| A browser keeps old bytes after an upgrade. | Hashed URLs and SRI from `PluginAssets`. |
| The app bundle runs before the loader. | The queue. The loader drains it at start. |
| A component throws during render. The island goes blank. | `onUncaughtError` puts the fallback back, sets `data-react-state="error"` and sends `autumn:react:error`. |
| Bad props JSON stops all islands. | The loader catches the error for that island only. |
| `useId` values collide between two roots. | Each root gets a unique `identifierPrefix`. |
| A props change resets the component state. | The loader calls `root.render` on the same root. |
| Two bundles register one name. | The first registration stays. The loader writes a console error. |
| The loader mounts an island inside another island. React and the loader fight over one DOM. | The loader skips islands inside an island. The docs say this. |
| The observer does work for each React DOM change. The page gets slow. | The loader ignores mutations inside mounted islands. |
| User HTML contains an island and mounts a real component. | `data-react-ignore` blocks islands. The docs tell the app to remove `data-react-*` in the sanitizer. |
| An element with `id="autumnReact"` clobbers the global. | The loader and the registration snippet check the global before they use it. |
| The loader script loads two times. | The second copy does nothing. |
| The island goes away before `idle` or `visible` fires. | Teardown cancels the pending trigger. |
| Props are not a JSON object (`5`, `[1]`). | `Island::props` returns `PropsError::NotAnObject`. |
| The app bundle uses the namespace `react`. | `ReactPlugin::bundle` stops with a clear message. |
| No JavaScript. | The fallback content stays. |

## 5. Six thinking hats

- **White (facts).** `autumn-web` 0.8.0 has `PluginAssets::from_files`,
  `deferred_script_tag`, `stylesheet_tag` and `AppBuilder::plugin_assets`.
  Files go to `/static/_plugins/<namespace>/`. The default CSP is
  `script-src 'self'`. React 19 has `createRoot(el, options)`,
  `root.render(element)` and `root.unmount()`. React 19 has no UMD build,
  so an app needs a bundler. Two sibling plugins (`autumn-plugin-svelte`,
  `autumn-plugin-vanilla`) use the same seam. Chromium and Playwright are on
  the test machine. Verus is not on this machine.
- **Red (feelings).** Developers want to write a `.jsx` file and put it in a
  Maud page with one line. Node to build is acceptable. Node at run time is
  not. A loss of component state after an htmx swap feels like a bug.
- **Black (risks).** `cargo test` does not test JavaScript. Control: real
  Chromium tests with real React 19. Risk: React changes its root API.
  Control: the app gives `createRoot`. Risk: large props in an attribute.
  Control: the docs say "keep props small". Risk: user HTML. Control:
  `data-react-ignore` and docs.
- **Yellow (benefits).** Rich islands in an htmx app. Cache and SRI with no
  work. You deploy one binary. Each island is independent. The same shape as
  the Svelte plugin, so the ecosystem stays consistent.
- **Green (alternatives).** Props updates that keep state. One
  `identifierPrefix` for each root. DOM events for htmx. TypeScript types
  for the registration API.
- **Blue (process).** Plan → RED (failing Rust and browser tests) → GREEN
  (minimum code) → REFACTOR → review from several angles → fix → AC
  evidence. Verus is not available. Property tests (`proptest`) and a state
  table with browser tests cover the invariants.

## 6. Island state machine

The loader keeps one record for each island element.

| From | Event | To |
| --- | --- | --- |
| (none) | scan finds the element, strategy `idle`/`visible` | `waiting` |
| (none) or `waiting` | trigger fires, component not registered | `pending` |
| `pending` | a bundle registers the name | `mounted` |
| (none) or `waiting` | trigger fires, component registered | `mounted` |
| `mounted` | `data-react-props` changes | `mounted` (same root, new props) |
| `mounted` | `data-react-island` changes | `mounted` (new root) |
| any | props are not a JSON object, or `createRoot` throws | `error` |
| `mounted` | React reports an uncaught error | `error` (fallback back) |
| any | element is not connected after a microtask | (none) |

Invariants:

- One element has one record and one root at most.
- An element inside another island, or inside `[data-react-ignore]`, has
  no record.
- A record in `error` or `pending` shows the fallback.

## 7. Decisions

See [ADR 0001](adr/0001-react-islands.md).

## 8. Acceptance criteria

No GitHub issue exists for this plugin. These criteria replace the issue.

| ID | Criterion |
| --- | --- |
| AC1 | `ReactPlugin::new()` installs the loader bundle (namespace `react`) through `AppBuilder::plugin_assets`. The loader is served at a hashed URL (`immutable`) and a plain URL (`must-revalidate`), with `ETag`/`304`. Unknown paths give `404`. |
| AC2 | `ReactPlugin::bundle(&BUNDLE)` installs an app bundle with the same URL and cache rules. The namespace `react` is refused. |
| AC3 | `react_script()` and `react_bundle(&BUNDLE)` render `<script>`/`<link>` tags with the hashed URL, SRI and `crossorigin="anonymous"`. |
| AC4 | `Island` renders a Maud element with name, JSON props, mount strategy, fallback, `id` and `class`. Props that are not a JSON object give a typed error. All values are escaped. |
| AC5 | The loader mounts a real React 19 component with its props in Chromium under a strict CSP. The console has no errors. |
| AC6 | The loader mounts islands that htmx swaps in. It unmounts islands that htmx swaps out. A moved island keeps its root. |
| AC7 | A `data-react-props` change renders the same root again. The component keeps its state. |
| AC8 | `idle` and `visible` wait for their trigger. Teardown cancels a pending trigger. |
| AC9 | Bad props, an unknown component or a render error affect one island only. The fallback stays or comes back. The island gets `data-react-state="error"` and sends `autumn:react:error`. |
| AC10 | Script order does not matter (queue). A late registration mounts waiting islands. One element mounts one time only. A second loader copy does nothing. |
| AC11 | Each root has a unique `identifierPrefix`. |
| AC12 | `data-react-ignore` and nested islands do not mount. The loader uses no `eval`, `new Function`, `innerHTML` or `document.write`. |
| AC13 | The plugin passes `autumn_web::plugin_conformance` and declares a `PluginContract` for `autumn-web` 0.8. A second install is harmless. |
| AC14 | A runnable example and a reference frontend (esbuild + React 19) exist. The example runs with no Node. An end-to-end test drives it with real htmx under the default CSP. |
| AC15 | `cargo fmt`, `cargo clippy` (pedantic, nursery, `-D warnings`), `cargo test`, doc tests and browser tests pass. Rust line coverage is 85% or more. |
| AC16 | README, CHANGELOG, ADR, CLAUDE.md, doc comments and a CI workflow exist. Text uses ASD-STE100. |
| AC17 | `PropsUpdate` sends new props for islands in an `HX-Trigger` header. The header is visible ASCII. The loader applies the `autumn:react:props` event. React keeps the state. |

## 9. Not in scope

- Server rendering or hydration of React components.
- A React version inside the plugin.
- An `autumn generate react` command. It needs a change in `autumn-cli`.
- An entry in the Autumn plugin index. It lists first-party crates only.
